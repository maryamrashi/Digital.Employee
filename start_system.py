import subprocess
import sys
import os

def main():
    print("🚀 Starting Digital FTE - Autonomous AI Employee System...")
    try:
        # Check if node_modules exists
        if not os.path.exists("node_modules"):
            print("📦 Installing dependencies...")
            subprocess.run(["npm", "install"], check=True)
        
        # Start the system
        print("💻 Starting Backend and Dashboard...")
        subprocess.run(["npm", "run", "dev"])
    except KeyboardInterrupt:
        print("\n🛑 System stopped.")
    except Exception as e:
        print(f"❌ Error starting system: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
