import subprocess
import os

os.chdir(r"C:\Users\Administrator\WorkBuddy\2026-05-07-task-1\daily-report-site")
result = subprocess.run(["npm", "install"], capture_output=True, text=True)
print("STDOUT:", result.stdout)
print("STDERR:", result.stderr)
print("Return code:", result.returncode)
