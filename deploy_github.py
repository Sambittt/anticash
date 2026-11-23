import subprocess
import json
import urllib.request
import urllib.error

# 1. Get git credentials
p = subprocess.Popen(
    ["git", "credential", "fill"],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    text=True
)
out, err = p.communicate(input="protocol=https\nhost=github.com\n\n")

token = None
username = None
for line in out.splitlines():
    if line.startswith("password="):
        token = line.split("=", 1)[1].strip()
    elif line.startswith("username="):
        username = line.split("=", 1)[1].strip()

print(f"Git username: {username}")
if not token:
    print("ERROR: No token found in credential helper")
    exit(1)

# 2. Check authenticated user via GitHub API
headers = {
    "Authorization": f"token {token}",
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "AntiCash-Setup"
}

req = urllib.request.Request("https://api.github.com/user", headers=headers)
try:
    with urllib.request.urlopen(req) as resp:
        user_data = json.loads(resp.read().decode())
        login = user_data.get("login")
        print(f"GitHub API verified login: {login}")
except Exception as e:
    print(f"GitHub API error verifying user: {e}")
    exit(1)

# 3. Create repository 'anticash' if it does not already exist
repo_name = "anticash"
repo_url = f"https://api.github.com/repos/{login}/{repo_name}"

check_req = urllib.request.Request(repo_url, headers=headers)
repo_exists = False
try:
    with urllib.request.urlopen(check_req) as resp:
        print(f"Repository {login}/{repo_name} already exists.")
        repo_exists = True
except urllib.error.HTTPError as e:
    if e.code == 404:
        print(f"Repository {login}/{repo_name} does not exist yet. Creating it...")
    else:
        print(f"HTTP error checking repo: {e}")

if not repo_exists:
    create_payload = json.dumps({
        "name": repo_name,
        "description": "AntiCash (anticash.tech) - Modern fast coming soon landing page",
        "homepage": "https://anticash.tech",
        "private": False,
        "has_issues": True,
        "has_projects": True,
        "has_wiki": False
    }).encode("utf-8")
    
    create_req = urllib.request.Request(
        "https://api.github.com/user/repos",
        data=create_payload,
        headers=headers,
        method="POST"
    )
    try:
        with urllib.request.urlopen(create_req) as resp:
            data = json.loads(resp.read().decode())
            print(f"Successfully created repository: {data.get('html_url')}")
    except urllib.error.HTTPError as e:
        print(f"Error creating repo: {e} - {e.read().decode()}")
        exit(1)

# 4. Initialize git repo, commit, and push
def run_cmd(args):
    print("Running:", " ".join(args))
    r = subprocess.run(args, capture_output=True, text=True)
    if r.stdout:
        print(r.stdout.strip())
    if r.stderr:
        print(r.stderr.strip())
    return r.returncode

run_cmd(["git", "init"])
run_cmd(["git", "config", "user.name", username or "Sambittt"])
run_cmd(["git", "config", "user.email", "satapathys198@gmail.com"])
run_cmd(["git", "add", "."])
run_cmd(["git", "commit", "-m", "Initial launch: AntiCash coming soon website"])
run_cmd(["git", "branch", "-M", "main"])

remote_url = f"https://github.com/{login}/{repo_name}.git"
run_cmd(["git", "remote", "remove", "origin"])
run_cmd(["git", "remote", "add", "origin", remote_url])
run_cmd(["git", "push", "-u", "origin", "main", "--force"])

# 5. Enable GitHub Pages on main branch
pages_payload = json.dumps({
    "source": {
        "branch": "main",
        "path": "/"
    }
}).encode("utf-8")

pages_req = urllib.request.Request(
    f"https://api.github.com/repos/{login}/{repo_name}/pages",
    data=pages_payload,
    headers=headers,
    method="POST"
)

try:
    with urllib.request.urlopen(pages_req) as resp:
        pdata = json.loads(resp.read().decode())
        print(f"GitHub Pages enabled! Status: {pdata.get('status')}, URL: {pdata.get('html_url')}")
except urllib.error.HTTPError as e:
    err_body = e.read().decode()
    print(f"Note on GitHub Pages API: {e.code} - {err_body}")

print("\nDeployment script completed successfully!")
