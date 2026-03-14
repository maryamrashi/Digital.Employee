import "dotenv/config";
import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import Database from "better-sqlite3";

// --- Database Setup ---
const dbFile = path.join(process.cwd(), "digital_fte.db");
const sqlite = new Database(dbFile);

// Initialize tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    priority TEXT NOT NULL,
    description TEXT,
    client_name TEXT,
    client_email TEXT,
    category TEXT,
    status TEXT DEFAULT 'pending',
    plan TEXT,
    action_details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Ensure new columns exist
try { sqlite.exec("ALTER TABLE tasks ADD COLUMN client_name TEXT;"); } catch(e) {}
try { sqlite.exec("ALTER TABLE tasks ADD COLUMN client_email TEXT;"); } catch(e) {}
try { sqlite.exec("ALTER TABLE tasks ADD COLUMN category TEXT;"); } catch(e) {}

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    action_type TEXT,
    actor TEXT,
    target TEXT,
    details TEXT
  );

  CREATE TABLE IF NOT EXISTS briefings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  INSERT OR IGNORE INTO settings (key, value) VALUES ('demo_mode', 'true');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('worker_running', 'true');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('smtp_configured', 'false');
`);

// --- Configuration ---
const PORT = 3000;

// --- Mock Email Service ---
const sendEmail = async (to: string, subject: string, body: string) => {
  console.log(`[EMAIL SERVICE] Sending to: ${to}`);
  console.log(`[EMAIL SERVICE] Subject: ${subject}`);
  console.log(`[EMAIL SERVICE] Body: ${body}`);
  
  // Log the email action
  sqlite.prepare("INSERT INTO logs (action_type, actor, target, details) VALUES (?, ?, ?, ?)")
    .run("email_sent", "system_mailer", to, subject);
    
  return true;
};

async function startServer() {
  const app = express();
  app.use(express.json());

  // --- API Endpoints ---

  // Submit Query (Public/User facing)
  app.post("/api/submit-query", async (req, res) => {
    try {
      const { name, email, description, category, priority } = req.body;
      const title = `Query from ${name}: ${description.substring(0, 30)}...`;
      
      const info = sqlite.prepare(
        "INSERT INTO tasks (title, type, priority, description, client_name, client_email, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted')"
      ).run(title, category || 'General', priority || 'Medium', description, name, email, category);
      
      const taskId = info.lastInsertRowid;
      
      // Send confirmation email
      await sendEmail(
        email, 
        "We received your request", 
        `Hi ${name},\n\nOur Digital FTE has received your request: "${description}".\n\nYou will be notified once our AI has analyzed the task and prepared an execution plan.\n\nBest regards,\nAutonomous Systems Team`
      );
      
      logAction("query_submitted", `Task #${taskId}`, "client", name);
      res.json({ id: taskId, status: "pending", message: "Query submitted successfully" });
    } catch (error) {
      console.error("Submit query error:", error);
      res.status(500).json({ error: "Failed to submit query" });
    }
  });

  // Fallback for old clients
  app.get("/api/vault/status", (req, res) => {
    res.json({ status: "migrated", message: "System upgraded to SQLite backend." });
  });

  // Tasks
  app.get("/api/tasks", (req, res) => {
    try {
      const status = req.query.status;
      let query = "SELECT * FROM tasks";
      const params = [];
      if (status) {
        query += " WHERE status = ?";
        params.push(status);
      }
      query += " ORDER BY created_at DESC";
      const tasks = sqlite.prepare(query).all(...params);
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch tasks" });
    }
  });

  app.post("/api/tasks", (req, res) => {
    try {
      const { title, type, priority, description, client_name, client_email, category } = req.body;
      const info = sqlite.prepare(
        "INSERT INTO tasks (title, type, priority, description, client_name, client_email, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted')"
      ).run(title, type, priority, description, client_name || 'Internal', client_email || 'internal@system.local', category || type);
      
      logAction("task_created", `Task #${info.lastInsertRowid}`, "user", title);
      res.json({ id: info.lastInsertRowid, status: "submitted" });
    } catch (error) {
      res.status(500).json({ error: "Failed to create task" });
    }
  });

  app.post("/api/tasks/:id/status", (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;
      sqlite.prepare("UPDATE tasks SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
      logAction("status_update", `Task #${id}`, "system", `New status: ${status}`);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update status" });
    }
  });

  app.post("/api/approve-task/:id", async (req, res) => {
    try {
      const { id } = req.params;
      sqlite.prepare("UPDATE tasks SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
      logAction("task_approved", `Task #${id}`, "user", "Manual Approval");
      
      const task = sqlite.prepare("SELECT * FROM tasks WHERE id = ?").get(id);
      if (task && task.client_email) {
        await sendEmail(
          task.client_email,
          "Update on your request",
          `Hi ${task.client_name},\n\nYour request "${task.title}" has been approved for execution. Our AI is now performing the necessary actions.\n\nBest regards,\nDigital FTE`
        );
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to approve task" });
    }
  });

  app.post("/approve-task/:id", (req, res) => res.redirect(307, `/api/approve-task/${req.params.id}`));

  app.post("/api/reject-task/:id", (req, res) => {
    try {
      const { id } = req.params;
      sqlite.prepare("UPDATE tasks SET status = 'rejected' WHERE id = ?").run(id);
      logAction("task_rejected", `Task #${id}`, "user", "Manual Rejection");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to reject task" });
    }
  });

  app.post("/reject-task/:id", (req, res) => res.redirect(307, `/api/reject-task/${req.params.id}`));

  // Keep old endpoints for compatibility if needed, but user asked for specific ones
  app.post("/api/tasks/:id/approve", (req, res) => res.redirect(307, `/api/approve-task/${req.params.id}`));
  app.post("/api/tasks/:id/reject", (req, res) => res.redirect(307, `/api/reject-task/${req.params.id}`));

  app.delete("/api/tasks/:id", (req, res) => {
    try {
      const { id } = req.params;
      sqlite.prepare("DELETE FROM tasks WHERE id = ?").run(id);
      logAction("task_deleted", `Task #${id}`, "user", "Manual Deletion");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete task" });
    }
  });

  // --- Lazy Workers (Triggered by API calls) ---
  const runLazyWorkers = async () => {
    const settings = sqlite.prepare("SELECT key, value FROM settings").all().reduce((acc: any, row: any) => {
      acc[row.key] = row.value === 'true';
      return acc;
    }, {});

    if (!settings.worker_running) return;

    // 1. Demo Query Generation (Lazy)
    if (settings.demo_mode) {
      const lastGenRow = sqlite.prepare("SELECT value FROM settings WHERE key = 'last_demo_gen'").get();
      const lastGen = lastGenRow ? parseInt(lastGenRow.value) : 0;
      const now = Date.now();
      
      if (now - lastGen > 15000) { // Every 15 seconds
        const names = ["Sarah Khan", "David Lee", "Michael Chen", "Emma Wilson", "James Rodriguez", "Aisha Patel", "Liam O'Connor", "Sofia Rossi"];
        const emails = ["sarah.khan@example.com", "david.lee@example.com", "m.chen@tech.co", "emma.w@design.studio", "james.rod@global.biz", "aisha.p@consulting.com", "liam.oc@startup.io", "s.rossi@fashion.it"];
        const requests = [
          "Please send invoice for website design",
          "Need help scheduling meeting with the board",
          "Update the financial report for Q1",
          "Send a follow-up email to the new leads",
          "Review the contract for the upcoming partnership",
          "Organize the team building event for next month",
          "Prepare the presentation for Friday's demo",
          "Check the status of the server migration"
        ];
        const categories = ["Finance", "Meeting", "Finance", "Communication", "Legal", "Operations", "Marketing", "Technical"];
        const priorities = ["High", "Medium", "Low", "Medium", "High", "Low", "High", "Medium"];

        const index = Math.floor(Math.random() * names.length);
        const name = names[index];
        const email = emails[index];
        const request = requests[index];
        const category = categories[index];
        const priority = priorities[index];
        
        const title = `Query: ${request.substring(0, 30)}...`;
        
        sqlite.prepare(
          "INSERT INTO tasks (title, type, priority, description, client_name, client_email, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted')"
        ).run(title, category, priority, request, name, email, category);
        
        sqlite.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_demo_gen', ?)").run(now.toString());
        logAction("demo_query_generated", "system", "demo_generator", `New query from ${name}`);
      }
    }

    // 2. AI Execution Worker (Lazy)
    const approvedTask = sqlite.prepare("SELECT * FROM tasks WHERE status = 'approved' LIMIT 1").get();
    if (approvedTask) {
      sqlite.prepare("UPDATE tasks SET status = 'executing', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(approvedTask.id);
      
      // We simulate the execution here. In a real serverless environment, 
      // this might be a separate function or a background task.
      // For this demo, we'll do a quick "execution".
      setTimeout(async () => {
        const actionResult = `Successfully completed ${approvedTask.type} action: ${approvedTask.action_details}`;
        sqlite.prepare("UPDATE tasks SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(approvedTask.id);
        logAction("task_completed", `Task #${approvedTask.id}`, "ai_worker_backend", actionResult);
        
        if (approvedTask.client_email) {
          await sendEmail(
            approvedTask.client_email,
            "Task Completed",
            `Hi ${approvedTask.client_name},\n\nWe are pleased to inform you that your request "${approvedTask.title}" has been successfully completed.\n\nDetails: ${approvedTask.action_details}\n\nThank you for using Digital FTE.\n\nBest regards,\nAutonomous Systems Team`
          );
        }
      }, 1000);
    }
  };

  // Stats (Heartbeat for Lazy Workers)
  app.get("/api/stats", async (req, res) => {
    try {
      // Trigger lazy workers on every stats call (heartbeat)
      await runLazyWorkers();

      const stats = {
        submitted: sqlite.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'submitted'").get().count,
        approvals: sqlite.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'awaiting_approval'").get().count,
        completed: sqlite.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'completed'").get().count,
        rejected: sqlite.prepare("SELECT COUNT(*) as count FROM tasks WHERE status = 'rejected'").get().count,
        briefings: sqlite.prepare("SELECT COUNT(*) as count FROM briefings").get().count,
        demo_mode: sqlite.prepare("SELECT value FROM settings WHERE key = 'demo_mode'").get().value === 'true',
        worker_running: sqlite.prepare("SELECT value FROM settings WHERE key = 'worker_running'").get().value === 'true'
      };
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Settings
  app.post("/api/settings/toggle", (req, res) => {
    try {
      const { key } = req.body;
      const row = sqlite.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      if (!row) {
        return res.status(404).json({ error: "Setting not found" });
      }
      const newValue = row.value === 'true' ? 'false' : 'true';
      sqlite.prepare("UPDATE settings SET value = ? WHERE key = ?").run(newValue, key);
      res.json({ key, value: newValue === 'true' });
    } catch (error) {
      res.status(500).json({ error: "Failed to toggle setting" });
    }
  });

  app.post("/api/system/clear-tasks", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM tasks").run();
      logAction("system_clear", "tasks", "user", "All tasks cleared");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear tasks" });
    }
  });

  app.post("/api/system/clear-briefings", (req, res) => {
    try {
      sqlite.prepare("DELETE FROM briefings").run();
      logAction("system_clear", "briefings", "user", "All briefings cleared");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to clear briefings" });
    }
  });

  // Briefings
  app.get("/api/briefings", (req, res) => {
    try {
      const briefings = sqlite.prepare("SELECT * FROM briefings ORDER BY created_at DESC").all();
      res.json(briefings);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch briefings" });
    }
  });

  app.post("/api/briefings", (req, res) => {
    try {
      const { content } = req.body;
      const date = new Date().toISOString().split('T')[0];
      sqlite.prepare("INSERT INTO briefings (date, content) VALUES (?, ?)").run(date, content);
      logAction("briefing_generated", date, "ai_engine_frontend", "Weekly Report");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to save briefing" });
    }
  });

  app.post("/api/tasks/:id/reasoning", (req, res) => {
    try {
      const { id } = req.params;
      const { plan, action_details, requires_approval } = req.body;
      
      // FORCE APPROVAL: If an action is proposed, it MUST be approved.
      // The user wants to force approval for almost everything that isn't just "thinking".
      const nextStatus = 'awaiting_approval'; 
      
      sqlite.prepare("UPDATE tasks SET plan = ?, action_details = ?, status = ? WHERE id = ?")
        .run(plan, action_details, nextStatus, id);
      
      logAction("ai_reasoning_complete", `Task #${id}`, "ai_engine_frontend", `Status: ${nextStatus}`);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to update task reasoning" });
    }
  });

  // --- Cleanup ---
  // Background intervals removed for serverless compatibility.
  // Logic moved to "Lazy Workers" triggered by /api/stats heartbeat.

  // Create Test Task if it doesn't exist
  const testTaskExists = sqlite.prepare("SELECT id FROM tasks WHERE title = 'Send invoice email to client'").get();
  if (!testTaskExists) {
    sqlite.prepare(
      "INSERT INTO tasks (title, type, priority, description, client_name, client_email, category, status) VALUES (?, 'Email', 'High', ?, 'Test Client', 'client@example.com', 'Finance', 'submitted')"
    ).run("Send invoice email to client", "Please send the monthly invoice for March 2026 to the client.");
    console.log("[System] Created test task: 'Send invoice email to client'");
  }

  // --- Vite Middleware ---
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Digital FTE Server running on http://localhost:${PORT}`);
  });
}

startServer();
