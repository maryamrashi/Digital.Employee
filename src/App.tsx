import React, { useState, useEffect } from "react";
import { 
  LayoutDashboard, 
  Inbox, 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  FileText, 
  Settings, 
  RefreshCw,
  ChevronRight,
  ShieldCheck,
  TrendingUp,
  Mail,
  DollarSign,
  Plus,
  X,
  Play,
  Pause,
  Zap,
  Trash2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { GoogleGenAI } from "@google/genai";

// --- AI Setup ---
const getAI = () => {
  const apiKey = (process.env as any).GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is missing. AI features will be disabled.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

// --- Components ---

const SidebarItem = ({ icon: Icon, label, active, onClick, count }: any) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all duration-300 ${
      active 
        ? "gradient-bg text-white shadow-lg shadow-brand-purple/20 scale-[1.02]" 
        : "text-zinc-500 hover:bg-zinc-100/50 hover:text-brand-purple"
    }`}
  >
    <div className="flex items-center gap-3">
      <Icon size={20} className={active ? "text-white" : "group-hover:text-brand-purple"} />
      <span className="font-semibold tracking-tight">{label}</span>
    </div>
    {count > 0 && (
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${active ? "bg-white/20" : "bg-zinc-100 text-zinc-500"}`}>
        {count}
      </span>
    )}
  </button>
);

const StatCard = ({ label, value, icon: Icon, color }: any) => (
  <div className="glass p-6 rounded-3xl border border-white/40 shadow-sm hover:shadow-md transition-all duration-300 group">
    <div className="flex items-center justify-between mb-4">
      <div className={`p-3 rounded-2xl bg-gradient-to-br ${color} text-white shadow-lg group-hover:scale-110 transition-transform duration-300`}>
        <Icon size={20} />
      </div>
      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Live Metrics</span>
    </div>
    <div className="text-3xl font-black text-zinc-900 tracking-tighter">{value}</div>
    <div className="text-xs font-bold text-zinc-500 mt-1 uppercase tracking-wider">{label}</div>
  </div>
);

const Modal = ({ isOpen, onClose, title, children }: any) => (
  <AnimatePresence>
    {isOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-brand-blue/40 backdrop-blur-md"
        />
        <motion.div 
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-lg glass rounded-[40px] shadow-2xl overflow-hidden border border-white/50"
        >
          <div className="px-10 py-8 border-b border-white/20 flex items-center justify-between">
            <h3 className="text-2xl font-black tracking-tight gradient-text">{title}</h3>
            <button onClick={onClose} className="p-2 hover:bg-white/50 rounded-full transition-colors">
              <X size={24} />
            </button>
          </div>
          <div className="p-10">
            {children}
          </div>
        </motion.div>
      </div>
    )}
  </AnimatePresence>
);

export default function App() {
  const [activeTab, setActiveTab] = useState("dashboard");
  const [stats, setStats] = useState<any>({ submitted: 0, approvals: 0, completed: 0, rejected: 0, briefings: 0, demo_mode: false, worker_running: true });
  const [tasks, setTasks] = useState<any[]>([]);
  const [briefings, setBriefings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTask, setNewTask] = useState({ 
    title: "", 
    type: "Email", 
    priority: "Medium", 
    description: "",
    client_name: "",
    client_email: "",
    category: "General"
  });
  const [isGeneratingBriefing, setIsGeneratingBriefing] = useState(false);
  const [isQuotaExceeded, setIsQuotaExceeded] = useState(false);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const fetchAll = async () => {
    try {
      const [statsRes, tasksRes, briefingsRes] = await Promise.all([
        fetch("/api/stats"),
        fetch("/api/tasks"),
        fetch("/api/briefings")
      ]);
      
      if (statsRes.ok) setStats(await statsRes.json());
      if (tasksRes.ok) setTasks(await tasksRes.json());
      if (briefingsRes.ok) setBriefings(await briefingsRes.json());
    } catch (err) {
      console.error("Failed to fetch data", err);
    } finally {
      setLoading(false);
    }
  };

  const extractJSON = (text: string) => {
    try {
      return JSON.parse(text);
    } catch (e) {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch (e2) {
          throw new Error("Failed to parse extracted JSON");
        }
      }
      throw new Error("No JSON found in response");
    }
  };

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 3000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // AI Worker (Frontend)
  useEffect(() => {
    if (!stats.worker_running) return;

    let isMounted = true;

    const processPendingTasks = async () => {
      const pendingTasks = tasks.filter(t => t.status === 'submitted');
      if (pendingTasks.length === 0) return;

      const ai = getAI();
      let localQuotaExceeded = isQuotaExceeded;
      
      for (const task of pendingTasks) {
        if (!isMounted || !stats.worker_running) break;
        
        console.log(`[AI Worker] Reasoning for task: ${task.title} (Quota Fallback: ${localQuotaExceeded})`);
        try {
          // Transition to ai_analysis
          await fetch(`/api/tasks/${task.id}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "ai_analysis" })
          });

          let result;
          
          if (!ai || localQuotaExceeded) {
            // Demo AI Mode Fallback - FORCE APPROVAL
            console.log("[AI Worker] Using Demo AI Mode fallback (Forcing Approval)");
            result = {
              plan: `[DEMO MODE] This is a simulated plan for ${task.title}. The AI has analyzed the request and determined that it involves ${task.category || task.type}.`,
              requires_approval: true, // DEFAULT TO REQUIRING APPROVAL
              action_details: `Simulated execution of ${task.type} action for ${task.client_name || 'internal request'}.`
            };
          } else {
            const response = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: `You are a Digital FTE Reasoning Engine. 
              Analyze this task and create a PLAN. 
              
              STRICT RULE: Every task that includes an action (email, invoice, meeting, finance, external comms) MUST require human approval.
              
              TASK:
              Title: ${task.title}
              Type: ${task.type}
              Priority: ${task.priority}
              Description: ${task.description}
              Client: ${task.client_name} (${task.client_email})
              Category: ${task.category}
              
              OUTPUT FORMAT (JSON):
              {
                "plan": "Detailed markdown plan",
                "requires_approval": true,
                "action_details": "What will be executed if approved"
              }`,
              config: { responseMimeType: "application/json" }
            });

            result = extractJSON(response.text);
            // Force true if AI is unsure or if it's an action
            result.requires_approval = true; 
          }

          const reasoningRes = await fetch(`/api/tasks/${task.id}/reasoning`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result)
          });
          
          if (!reasoningRes.ok) throw new Error(`Failed to save reasoning: ${reasoningRes.status}`);

          if (ai && !localQuotaExceeded) setIsQuotaExceeded(false); 
          fetchAll();
          
          await sleep(2000);
        } catch (error: any) {
          const isQuota = error?.message?.includes("429") || error?.message?.includes("RESOURCE_EXHAUSTED") || (error?.status === 429);
          
          if (isQuota) {
            console.warn(`[AI Worker] Quota exceeded for task ${task.id}. Switching to Demo AI Mode immediately.`);
            localQuotaExceeded = true;
            setIsQuotaExceeded(true);
          } else {
            console.error(`[AI Worker] Reasoning failed for ${task.id}:`, error);
          }
        }
      }
    };

    processPendingTasks();
    
    return () => { isMounted = false; };
  }, [tasks, stats.worker_running, isQuotaExceeded]);

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const endpoint = activeTab === "submit_query" ? "/api/submit-query" : "/api/tasks";
      const payload = activeTab === "submit_query" ? {
        name: newTask.client_name,
        email: newTask.client_email,
        description: newTask.description,
        category: newTask.category,
        priority: newTask.priority
      } : newTask;

      await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      
      setIsModalOpen(false);
      setNewTask({ 
        title: "", 
        type: "Email", 
        priority: "Medium", 
        description: "",
        client_name: "",
        client_email: "",
        category: "General"
      });
      setActiveTab("dashboard");
      fetchAll();
    } catch (err) {
      console.error("Failed to create task", err);
    }
  };

  const handleApprove = async (id: number) => {
    try {
      await fetch(`/api/approve-task/${id}`, { method: "POST" });
      fetchAll();
    } catch (err) {
      console.error("Failed to approve task", err);
    }
  };

  const handleReject = async (id: number) => {
    try {
      await fetch(`/api/reject-task/${id}`, { method: "POST" });
      fetchAll();
    } catch (err) {
      console.error("Failed to reject task", err);
    }
  };

  const handleDeleteTask = async (id: number) => {
    try {
      await fetch(`/api/tasks/${id}`, { method: "DELETE" });
      fetchAll();
    } catch (err) {
      console.error("Failed to delete task", err);
    }
  };

  const toggleSetting = async (key: string) => {
    try {
      await fetch("/api/settings/toggle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key })
      });
      fetchAll();
    } catch (err) {
      console.error("Failed to toggle setting", err);
    }
  };

  const clearAllTasks = async () => {
    try {
      await fetch("/api/system/clear-tasks", { method: "POST" });
      fetchAll();
    } catch (err) {
      console.error("Failed to clear tasks", err);
    }
  };

  const clearAllBriefings = async () => {
    try {
      await fetch("/api/system/clear-briefings", { method: "POST" });
      fetchAll();
    } catch (err) {
      console.error("Failed to clear briefings", err);
    }
  };

  const generateBriefing = async () => {
    setIsGeneratingBriefing(true);
    try {
      const ai = getAI();
      
      const completedTasks = tasks.filter(t => t.status === 'completed');
      const taskList = completedTasks.map(t => t.title).join(", ");
      let content = "";

      if (!ai || isQuotaExceeded) {
        console.log("[Briefing] Using Demo AI Mode fallback for briefing");
        content = `[DEMO BRIEFING] Executive Summary: The Digital FTE has successfully processed ${completedTasks.length} tasks this period. Revenue remains stable at $15,400. System status is optimal. 
        
Completed Tasks: ${taskList || "No tasks completed in this window."}
        
Strategic Insight: Autonomous operations are performing at 98% efficiency. Recommend increasing task throughput for high-priority categories.`;
      } else {
        try {
          const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `You are a Senior Business Analyst AI. 
            Generate a "Monday Morning CEO Briefing" based on:
            - Completed Tasks: ${taskList || "None yet"}
            - Simulated Revenue: $15,400
            - System Status: All watchers active
            
            Sections: Executive Summary, Revenue Analysis, Completed Tasks, Bottlenecks, Upcoming Deadlines, Cost Optimization Suggestions.`,
          });
          content = response.text || "Failed to generate briefing.";
        } catch (aiErr: any) {
          if (aiErr?.message?.includes("429") || aiErr?.message?.includes("RESOURCE_EXHAUSTED")) {
            setIsQuotaExceeded(true);
            // Recursive call or just use fallback immediately
            console.warn("[Briefing] Quota hit during generation, using fallback.");
            content = `[DEMO BRIEFING] Executive Summary: The Digital FTE has successfully processed ${completedTasks.length} tasks this period. Revenue remains stable at $15,400. System status is optimal. 
        
Completed Tasks: ${taskList || "No tasks completed in this window."}
        
Strategic Insight: Autonomous operations are performing at 98% efficiency. Recommend increasing task throughput for high-priority categories.`;
          } else {
            throw aiErr;
          }
        }
      }
      
      const res = await fetch("/api/briefings", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      
      if (!res.ok) throw new Error("Failed to save briefing");
      setActiveTab("briefings");
      fetchAll();
    } catch (err) {
      console.error("Failed to generate briefing", err);
    } finally {
      setIsGeneratingBriefing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex font-sans text-zinc-900 selection:bg-brand-purple/20">
      {/* Sidebar */}
      <aside className="w-72 bg-white/80 backdrop-blur-xl border-r border-zinc-200/50 p-8 flex flex-col gap-10 shadow-2xl z-10">
        <div className="flex items-center gap-4 px-2">
          <div className="w-12 h-12 gradient-bg rounded-2xl flex items-center justify-center text-white font-black text-xl shadow-lg shadow-brand-purple/30">
            FTE
          </div>
          <div>
            <h1 className="font-black text-xl leading-tight tracking-tighter gradient-text">Digital FTE</h1>
            <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Enterprise AI</p>
          </div>
        </div>

        <nav className="flex flex-col gap-2">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" active={activeTab === "dashboard"} onClick={() => setActiveTab("dashboard")} />
          <SidebarItem icon={Plus} label="Submit Query" active={activeTab === "submit_query"} onClick={() => setActiveTab("submit_query")} />
          <SidebarItem icon={Inbox} label="Needs Action" active={activeTab === "needs_action"} onClick={() => setActiveTab("needs_action")} count={stats.submitted} />
          <SidebarItem icon={ShieldCheck} label="Approvals" active={activeTab === "approvals"} onClick={() => setActiveTab("approvals")} count={stats.approvals} />
          <SidebarItem icon={FileText} label="Briefings" active={activeTab === "briefings"} onClick={() => setActiveTab("briefings")} count={stats.briefings} />
          <SidebarItem icon={CheckCircle} label="Completed" active={activeTab === "done"} onClick={() => setActiveTab("done")} count={stats.completed} />
          <SidebarItem icon={AlertCircle} label="Rejected" active={activeTab === "rejected"} onClick={() => setActiveTab("rejected")} count={stats.rejected} />
          <SidebarItem icon={Settings} label="Settings" active={activeTab === "settings"} onClick={() => setActiveTab("settings")} />
        </nav>

        <div className="mt-auto space-y-4">
          <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold uppercase tracking-tighter text-zinc-500">Demo Mode</span>
              <button 
                onClick={() => toggleSetting("demo_mode")}
                className={`w-10 h-5 rounded-full transition-colors relative ${stats.demo_mode ? "bg-emerald-500" : "bg-zinc-300"}`}
              >
                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${stats.demo_mode ? "right-1" : "left-1"}`} />
              </button>
            </div>
            <p className="text-[10px] text-zinc-400 leading-tight">
              Automatically generates and processes tasks for demonstration.
            </p>
          </div>

          <div className="bg-zinc-50 p-4 rounded-2xl border border-zinc-100">
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full ${stats.worker_running ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
              <span className="text-xs font-bold uppercase tracking-tighter text-zinc-500">
                Worker {stats.worker_running ? "Active" : "Paused"}
              </span>
            </div>
            <button 
              onClick={() => toggleSetting("worker_running")}
              className="w-full py-2 bg-white border border-zinc-200 rounded-lg text-[10px] font-bold uppercase hover:bg-zinc-50 transition-colors"
            >
              {stats.worker_running ? "Pause Worker" : "Resume Worker"}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-10 overflow-y-auto">
        <header className="flex items-center justify-between mb-10">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              {activeTab.charAt(0).toUpperCase() + activeTab.slice(1).replace("_", " ")}
            </h2>
            <p className="text-zinc-500 mt-1">
              {activeTab === "dashboard" && "Overview of your digital employee's performance and activity."}
              {activeTab === "submit_query" && "Submit a new business query for the AI to process."}
              {activeTab === "needs_action" && "Tasks currently being analyzed or waiting for AI reasoning."}
              {activeTab === "approvals" && "Critical actions that require your manual approval before execution."}
              {activeTab === "briefings" && "Weekly executive summaries and business intelligence reports."}
              {activeTab === "done" && "History of all successfully completed autonomous actions."}
              {activeTab === "settings" && "System configuration, maintenance, and automation controls."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsModalOpen(true)}
              className="gradient-button flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-black uppercase tracking-wider"
            >
              <Plus size={18} strokeWidth={3} />
              Create Task
            </button>
            <button 
              onClick={generateBriefing}
              disabled={isGeneratingBriefing}
              className="flex items-center gap-2 px-6 py-3 bg-white border border-zinc-200 rounded-2xl text-sm font-bold hover:bg-zinc-50 transition-all shadow-sm disabled:opacity-50"
            >
              <Zap size={18} className={isGeneratingBriefing ? "text-amber-500 animate-pulse" : "text-amber-500"} />
              {isGeneratingBriefing ? "Generating..." : "Generate Briefing"}
            </button>
          </div>
        </header>

        <AnimatePresence mode="wait">
          {activeTab === "dashboard" && (
            <motion.div key="dashboard" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-8">
              <div className="grid grid-cols-5 gap-6">
                <StatCard label="Submitted" value={stats.submitted} icon={Inbox} color="bg-indigo-500" />
                <StatCard label="Approvals" value={stats.approvals} icon={ShieldCheck} color="bg-amber-500" />
                <StatCard label="Completed" value={stats.completed} icon={CheckCircle} color="bg-emerald-500" />
                <StatCard label="Rejected" value={stats.rejected} icon={AlertCircle} color="bg-red-500" />
                <StatCard label="Reports" value={stats.briefings} icon={FileText} color="bg-zinc-800" />
              </div>

              <div className="grid grid-cols-3 gap-8">
                <div className="col-span-2 space-y-6">
                  <div className="glass p-8 rounded-[40px] border border-white/40">
                    <div className="flex items-center justify-between mb-8">
                      <h3 className="text-2xl font-black tracking-tight">Recent Activity</h3>
                      <button onClick={() => setActiveTab("done")} className="text-xs font-bold text-brand-purple hover:underline uppercase tracking-widest">View All</button>
                    </div>
                    <div className="space-y-4">
                      {tasks.slice(0, 5).map((task) => (
                        <div key={task.id} className="flex items-center justify-between p-5 bg-white/50 hover:bg-white transition-colors rounded-3xl border border-zinc-100/50 group">
                          <div className="flex items-center gap-5">
                            <div className={`p-3 rounded-2xl ${task.status === 'done' ? 'bg-emerald-100 text-emerald-600' : 'bg-brand-purple/10 text-brand-purple'}`}>
                              {task.type === 'Email' ? <Mail size={20} /> : <DollarSign size={20} />}
                            </div>
                            <div>
                              <h4 className="font-bold text-zinc-900">{task.title}</h4>
                              <p className="text-[10px] text-zinc-400 uppercase font-bold tracking-widest mt-0.5">{task.status.replace("_", " ")} • {task.category || task.type} • {task.priority}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteTask(task.id);
                              }}
                              className="p-2 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 size={18} />
                            </button>
                            <ChevronRight size={20} className="text-zinc-300" />
                          </div>
                        </div>
                      ))}
                      {tasks.length === 0 && <p className="text-center text-zinc-400 py-16 font-medium">No recent activity detected.</p>}
                    </div>
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="gradient-bg text-white p-10 rounded-[40px] shadow-2xl shadow-brand-purple/20 relative overflow-hidden group">
                    <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-3xl group-hover:bg-white/20 transition-colors" />
                    <h3 className="text-xl font-black mb-6 flex items-center gap-3">
                      <TrendingUp size={24} />
                      AI Insights
                    </h3>
                    <p className="text-white/70 text-sm leading-relaxed mb-8 font-medium">
                      The AI worker is currently monitoring {stats.submitted} tasks. Demo mode is {stats.demo_mode ? "active" : "inactive"}.
                    </p>
                    {isQuotaExceeded && (
                      <div className="mb-8 p-5 bg-white/10 backdrop-blur-md border border-white/20 rounded-3xl flex items-start gap-4">
                        <AlertCircle size={20} className="text-white shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-black uppercase tracking-widest">Quota Exceeded</p>
                          <p className="text-[10px] text-white/60 mt-1 font-medium">
                            AI rate limits reached. Processing will resume automatically soon.
                          </p>
                          <button 
                            onClick={() => setIsQuotaExceeded(false)}
                            className="text-[10px] font-bold text-white underline mt-3 hover:text-white/80 transition-colors"
                          >
                            Retry Now
                          </button>
                        </div>
                      </div>
                    )}
                    <div className="space-y-4">
                      <button onClick={() => setActiveTab("submit_query")} className="w-full py-4 bg-white text-brand-blue rounded-2xl font-black text-sm hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl">
                        Submit New Query
                      </button>
                      <button onClick={() => toggleSetting("demo_mode")} className="w-full py-4 bg-white/10 text-white border border-white/20 rounded-2xl font-black text-sm hover:bg-white/20 transition-all">
                        {stats.demo_mode ? "Disable Demo Mode" : "Enable Demo Mode"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {activeTab === "submit_query" && (
            <motion.div key="submit_query" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="max-w-2xl mx-auto">
              <div className="glass p-12 rounded-[48px] border border-white/40">
                <div className="mb-10">
                  <h3 className="text-3xl font-black tracking-tight gradient-text">Submit Business Query</h3>
                  <p className="text-zinc-500 mt-3 font-medium">Our AI employee will analyze your request and prepare an execution plan.</p>
                </div>
                <form onSubmit={handleCreateTask} className="space-y-8">
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Your Name</label>
                      <input 
                        required
                        value={newTask.client_name}
                        onChange={(e) => setNewTask({ ...newTask, client_name: e.target.value })}
                        className="w-full px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-purple/20 transition-all"
                        placeholder="John Doe"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Email Address</label>
                      <input 
                        required
                        type="email"
                        value={newTask.client_email}
                        onChange={(e) => setNewTask({ ...newTask, client_email: e.target.value })}
                        className="w-full px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-purple/20 transition-all"
                        placeholder="john@company.com"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Category</label>
                      <select 
                        value={newTask.category}
                        onChange={(e) => setNewTask({ ...newTask, category: e.target.value })}
                        className="w-full px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:outline-none transition-all"
                      >
                        <option>General</option>
                        <option>Finance</option>
                        <option>Communication</option>
                        <option>Research</option>
                        <option>Technical</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Priority</label>
                      <select 
                        value={newTask.priority}
                        onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                        className="w-full px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:outline-none transition-all"
                      >
                        <option>Low</option>
                        <option>Medium</option>
                        <option>High</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Query Description</label>
                    <textarea 
                      required
                      rows={5}
                      value={newTask.description}
                      onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                      className="w-full px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-purple/20 transition-all"
                      placeholder="Describe what you need the AI employee to do..."
                    />
                  </div>
                  <button 
                    type="submit"
                    disabled={loading}
                    className="w-full py-5 gradient-button rounded-[24px] font-black text-lg shadow-2xl flex items-center justify-center gap-3"
                  >
                    {loading ? <RefreshCw className="animate-spin" size={24} /> : <Zap size={24} className="text-amber-400" />}
                    {loading ? "Submitting..." : "Submit to Digital FTE"}
                  </button>
                </form>
              </div>
            </motion.div>
          )}

          {(activeTab === "needs_action" || activeTab === "done" || activeTab === "rejected") && (
            <motion.div key={activeTab} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
              {tasks
                .filter(t => {
                  if (activeTab === "needs_action") return t.status === "submitted" || t.status === "ai_analysis";
                  if (activeTab === "done") return t.status === "completed" || t.status === "executing";
                  if (activeTab === "rejected") return t.status === "rejected";
                  return true;
                })
                .map((task) => (
                <div key={task.id} className="glass p-8 rounded-[32px] border border-white/40 group">
                  <div className="flex items-start justify-between mb-6">
                    <div className="flex gap-5">
                      <div className={`p-4 rounded-2xl shadow-inner ${task.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : task.status === 'rejected' ? 'bg-red-100 text-red-600' : task.status === 'ai_analysis' || task.status === 'executing' ? 'bg-amber-100 text-amber-600' : 'bg-brand-purple/10 text-brand-purple'}`}>
                        {task.type === 'Email' ? <Mail size={28} /> : <DollarSign size={28} />}
                      </div>
                      <div>
                        <h3 className="text-xl font-black tracking-tight">{task.title}</h3>
                        <div className="flex gap-4 mt-2">
                          <span className={`text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full ${
                            task.priority === 'High' ? 'bg-red-100 text-red-600' : 'bg-zinc-100 text-zinc-500'
                          }`}>
                            {task.priority}
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-1">
                            <Clock size={12} />
                            {new Date(task.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button 
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-3 text-zinc-300 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all opacity-0 group-hover:opacity-100"
                      title="Delete Task"
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                  <div className="bg-white/40 p-6 rounded-3xl border border-white/20">
                    <p className="text-sm text-zinc-600 leading-relaxed whitespace-pre-wrap font-medium">{task.description}</p>
                    {task.plan && (
                      <div className="mt-6 pt-6 border-t border-zinc-200/50">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">AI Execution Plan</h4>
                        <p className="text-sm text-zinc-500 italic font-medium leading-relaxed">{task.plan}</p>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {tasks.length === 0 && (
                <div className="bg-white p-20 rounded-3xl border border-dashed border-zinc-200 flex flex-col items-center justify-center text-center">
                  <Inbox size={48} className="text-zinc-200 mb-4" />
                  <h3 className="text-xl font-bold text-zinc-400">No tasks in this category</h3>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "approvals" && (
            <motion.div key="approvals" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-8">
              {tasks
                .filter(t => t.status === "awaiting_approval")
                .map((task) => (
                <div key={task.id} className="glass overflow-hidden rounded-[48px] border border-white/40 shadow-2xl">
                  <div className="gradient-bg p-6 flex items-center justify-between text-white">
                    <div className="flex items-center gap-3">
                      <ShieldCheck size={24} strokeWidth={2.5} />
                      <span className="text-sm font-black uppercase tracking-widest">Human Approval Required</span>
                    </div>
                    <span className="text-[10px] font-black opacity-60 tracking-tighter">REF_ID: {task.id}</span>
                  </div>
                  <div className="p-10">
                    <div className="grid grid-cols-3 gap-10 mb-10">
                      <div className="col-span-2">
                        <h3 className="text-3xl font-black tracking-tight mb-4">{task.title}</h3>
                        <p className="text-zinc-500 text-base leading-relaxed font-medium">{task.description}</p>
                      </div>
                      <div className="space-y-4">
                        <div className="p-5 bg-white/50 rounded-3xl border border-zinc-100">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Client Context</p>
                          <p className="text-sm font-black text-zinc-900">{task.client_name || "Unknown"}</p>
                          <p className="text-xs text-zinc-500 font-medium">{task.client_email || "No email"}</p>
                        </div>
                        <div className="p-5 bg-white/50 rounded-3xl border border-zinc-100">
                          <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-2">Category</p>
                          <p className="text-sm font-black text-zinc-900">{task.category || task.type}</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-brand-blue rounded-[32px] p-8 text-zinc-300 mb-10 shadow-inner relative overflow-hidden">
                      <div className="absolute right-0 top-0 w-32 h-32 bg-brand-purple/20 blur-[80px]" />
                      <div className="flex items-center gap-3 mb-6 text-brand-purple">
                        <Zap size={20} strokeWidth={3} />
                        <h4 className="text-xs font-black uppercase tracking-widest">Proposed AI Execution</h4>
                      </div>
                      <p className="text-base font-mono leading-relaxed mb-6 text-white bg-black/20 p-4 rounded-xl border border-white/5">
                        {task.action_details || "No action details generated yet."}
                      </p>
                      <div className="pt-6 border-t border-white/10">
                        <h4 className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-3">Reasoning Logic</h4>
                        <p className="text-xs italic text-zinc-400 leading-relaxed">{task.plan}</p>
                      </div>
                    </div>

                    <div className="flex gap-6">
                      <button 
                        onClick={() => handleReject(task.id)}
                        className="flex-1 py-5 bg-zinc-100 text-zinc-600 rounded-3xl font-black text-sm uppercase tracking-widest hover:bg-zinc-200 transition-all"
                      >
                        Reject
                      </button>
                      <button 
                        onClick={() => handleApprove(task.id)}
                        className="flex-[2] py-5 gradient-button rounded-3xl font-black text-sm uppercase tracking-widest flex items-center justify-center gap-3"
                      >
                        <CheckCircle size={24} strokeWidth={2.5} className="text-emerald-400" />
                        Approve & Execute
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {tasks.length === 0 && (
                <div className="bg-white p-20 rounded-3xl border border-dashed border-zinc-200 flex flex-col items-center justify-center text-center">
                  <ShieldCheck size={48} className="text-zinc-200 mb-4" />
                  <h3 className="text-xl font-bold text-zinc-400">No pending approvals</h3>
                  <p className="text-zinc-400 text-sm mt-2">All tasks are either processed or awaiting AI analysis.</p>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "briefings" && (
            <motion.div key="briefings" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-8">
              {briefings.map((b) => (
                <div key={b.id} className="glass p-10 rounded-[40px] border border-white/40 shadow-xl">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-2xl font-black tracking-tight gradient-text">CEO Briefing • {b.date}</h3>
                    <span className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{new Date(b.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="prose prose-zinc max-w-none">
                    <pre className="whitespace-pre-wrap font-sans text-zinc-600 text-sm leading-relaxed bg-white/50 p-8 rounded-3xl border border-zinc-100 shadow-inner">
                      {b.content}
                    </pre>
                  </div>
                </div>
              ))}
              {briefings.length === 0 && (
                <div className="bg-white p-20 rounded-3xl border border-dashed border-zinc-200 flex flex-col items-center justify-center text-center">
                  <FileText size={48} className="text-zinc-200 mb-4" />
                  <h3 className="text-xl font-bold text-zinc-400">No briefings generated yet</h3>
                </div>
              )}
            </motion.div>
          )}

          {activeTab === "settings" && (
            <motion.div key="settings" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-10">
              <div className="glass p-10 rounded-[40px] border border-white/40 shadow-xl">
                <h3 className="text-2xl font-black tracking-tight mb-8 gradient-text">System Maintenance</h3>
                <div className="grid grid-cols-2 gap-8">
                  <div className="p-8 bg-white/50 rounded-3xl border border-zinc-100">
                    <h4 className="font-black text-lg mb-3">Task Management</h4>
                    <p className="text-sm text-zinc-500 mb-6 font-medium">Clear all tasks from the database. This includes pending, approved, and completed tasks.</p>
                    <button 
                      onClick={clearAllTasks}
                      className="px-6 py-3 bg-red-50 text-red-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-100 transition-colors flex items-center gap-2"
                    >
                      <Trash2 size={16} />
                      Clear All Tasks
                    </button>
                  </div>
                  <div className="p-8 bg-white/50 rounded-3xl border border-zinc-100">
                    <h4 className="font-black text-lg mb-3">Briefing Archive</h4>
                    <p className="text-sm text-zinc-500 mb-6 font-medium">Permanently delete all generated CEO briefings and reports.</p>
                    <button 
                      onClick={clearAllBriefings}
                      className="px-6 py-3 bg-red-50 text-red-600 rounded-2xl text-xs font-black uppercase tracking-widest hover:bg-red-100 transition-colors flex items-center gap-2"
                    >
                      <Trash2 size={16} />
                      Clear All Briefings
                    </button>
                  </div>
                </div>
              </div>

              <div className="glass p-10 rounded-[40px] border border-white/40 shadow-xl">
                <h3 className="text-2xl font-black tracking-tight mb-8 gradient-text">Automation Settings</h3>
                <div className="space-y-6">
                  <div className="flex items-center justify-between p-6 bg-white/50 rounded-3xl border border-zinc-100">
                    <div>
                      <h4 className="font-black text-lg">Demo Mode</h4>
                      <p className="text-xs text-zinc-400 font-medium">Simulate incoming emails and bank transactions</p>
                    </div>
                    <button 
                      onClick={() => toggleSetting("demo_mode")}
                      className={`w-14 h-7 rounded-full transition-colors relative ${stats.demo_mode ? "gradient-bg" : "bg-zinc-300"}`}
                    >
                      <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all shadow-md ${stats.demo_mode ? "right-1" : "left-1"}`} />
                    </button>
                  </div>
                  <div className="flex items-center justify-between p-6 bg-white/50 rounded-3xl border border-zinc-100">
                    <div>
                      <h4 className="font-black text-lg">AI Worker Engine</h4>
                      <p className="text-xs text-zinc-400 font-medium">Enable autonomous reasoning and task execution</p>
                    </div>
                    <button 
                      onClick={() => toggleSetting("worker_running")}
                      className={`w-14 h-7 rounded-full transition-colors relative ${stats.worker_running ? "gradient-bg" : "bg-zinc-300"}`}
                    >
                      <div className={`absolute top-1 w-5 h-5 bg-white rounded-full transition-all shadow-md ${stats.worker_running ? "right-1" : "left-1"}`} />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Create Task Modal */}
      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="Create New Task">
        <form onSubmit={handleCreateTask} className="space-y-8">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Task Title</label>
            <input 
              required
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              className="w-full px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-purple/20 transition-all"
              placeholder="e.g. Respond to Acme Corp Invoice"
            />
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Type</label>
              <select 
                value={newTask.type}
                onChange={(e) => setNewTask({ ...newTask, type: e.target.value })}
                className="w-full px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:outline-none transition-all"
              >
                <option>Email</option>
                <option>Finance</option>
                <option>Message</option>
                <option>Custom</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Priority</label>
              <select 
                value={newTask.priority}
                onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                className="w-full px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:outline-none transition-all"
              >
                <option>Low</option>
                <option>Medium</option>
                <option>High</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-3">Description</label>
            <textarea 
              required
              rows={4}
              value={newTask.description}
              onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
              className="w-full px-5 py-4 bg-white/50 border border-zinc-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-brand-purple/20 transition-all"
              placeholder="Describe the task in detail..."
            />
          </div>
          <button 
            type="submit"
            disabled={loading}
            className="w-full py-5 gradient-button rounded-[24px] font-black text-lg shadow-2xl disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Autonomous Task"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
