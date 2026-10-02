"""Create OptiMesh labels, milestones and issues without duplicating prior runs."""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

MANIFEST = Path(__file__).resolve().parents[1] / ".github" / "project-plan.json"


class GitHub:
    def __init__(self, repo, token):
        self.base = f"https://api.github.com/repos/{repo}"
        self.token = token

    def request(self, method, path="", body=None):
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "X-GitHub-Api-Version": "2026-03-10",
            "User-Agent": "optimesh-project-setup",
        }
        data = json.dumps(body).encode() if body is not None else None
        req = Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urlopen(req, timeout=30) as response:
                return json.load(response)
        except HTTPError as error:
            # Do not dump request headers, tokens or server-supplied sensitive data.
            raise RuntimeError(f"GitHub {method} {path}: HTTP {error.code}") from None

    def all(self, path):
        items = []
        separator = "&" if "?" in path else "?"
        page = 1
        while True:
            rows = self.request("GET", f"{path}{separator}per_page=100&page={page}")
            items.extend(rows)
            if len(rows) < 100:
                return items
            page += 1


def validate(plan):
    for key, field in [("labels", "name"), ("milestones", "title"), ("issues", "id")]:
        values = [row[field] for row in plan[key]]
        if len(values) != len(set(values)):
            raise ValueError(f"Duplicate {key} identifiers")
    labels = {row["name"] for row in plan["labels"]}
    milestones = {row["title"] for row in plan["milestones"]}
    titles = [row["title"] for row in plan["issues"]]
    if len(titles) != len(set(titles)):
        raise ValueError("Duplicate issue titles")
    for label in plan["labels"]:
        if not re.fullmatch(r"[0-9a-fA-F]{6}", label["color"]):
            raise ValueError(f"Invalid label color: {label['name']}")
    for issue in plan["issues"]:
        if issue["milestone"] not in milestones or not set(issue["labels"]) <= labels:
            raise ValueError(f"Unknown milestone or labels in {issue['id']}")


def bootstrap(client, plan, actions_token=False):
    metadata = client.request("GET")
    permissions = metadata.get("permissions", {})
    if not actions_token and not any(permissions.get(p) for p in ("push", "maintain", "admin")):
        raise RuntimeError("Repository write access is required; nothing was changed.")

    existing_labels = {row["name"]: row for row in client.all("/labels")}
    for label in plan["labels"]:
        existing = existing_labels.get(label["name"])
        if existing is None:
            client.request("POST", "/labels", label)
        elif any(existing.get(key) != label[key] for key in ("color", "description")):
            client.request("PATCH", "/labels/" + quote(label["name"], safe=""), label)

    existing_milestones = {row["title"]: row for row in client.all("/milestones?state=all")}
    milestone_numbers = {}
    for milestone in plan["milestones"]:
        current = existing_milestones.get(milestone["title"])
        if current is None:
            current = client.request("POST", "/milestones", milestone)
        elif current.get("description") != milestone["description"]:
            client.request("PATCH", f"/milestones/{current['number']}", milestone)
        milestone_numbers[milestone["title"]] = current["number"]

    existing_issues = [row for row in client.all("/issues?state=all") if "pull_request" not in row]
    for issue in plan["issues"]:
        marker = f"<!-- optimesh-backlog:{issue['id']} -->"
        current = next(
            (row for row in existing_issues
             if marker in (row.get("body") or "") or row["title"] == issue["title"]), None,
        )
        desired = {
            "labels": issue["labels"],
            "milestone": milestone_numbers[issue["milestone"]],
        }
        if current is None:
            current = client.request("POST", "/issues", {
                **desired, "title": issue["title"], "body": issue["body"] + "\n\n" + marker,
            })
            existing_issues.append(current)
            print(f"Created #{current['number']}: {issue['title']}")
        else:
            old_labels = {row["name"] for row in current.get("labels", [])}
            # Keep any labels added by humans, plus the planned labels.
            desired["labels"] = sorted(old_labels | set(issue["labels"]))
            old_milestone = (current.get("milestone") or {}).get("number")
            if old_labels != set(desired["labels"]) or old_milestone != desired["milestone"]:
                client.request("PATCH", f"/issues/{current['number']}", desired)
            print(f"Existing #{current['number']}: {issue['title']}")


def token_from_environment():
    token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
    if token:
        return token
    try:
        return subprocess.check_output(
            ["gh", "auth", "token"], text=True, stderr=subprocess.DEVNULL,
        ).strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        raise RuntimeError("Set GH_TOKEN or authenticate with gh auth login.") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="owner/name")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print; no network/mutations")
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", args.repo):
        parser.error("--repo must be owner/name")
    plan = json.loads(MANIFEST.read_text(encoding="utf-8"))
    validate(plan)
    if args.dry_run:
        print(f"{args.repo}: {len(plan['labels'])} labels, "
              f"{len(plan['milestones'])} milestones, {len(plan['issues'])} issues")
        for issue in plan["issues"]:
            print(f"{issue['milestone']}: {issue['title']}")
        return
    # Actions uses an explicit issues:write token for this same repository;
    # its contents permission need not grant git push.
    actions_token = (
        os.environ.get("GITHUB_ACTIONS") == "true"
        and os.environ.get("GITHUB_REPOSITORY") == args.repo
    )
    bootstrap(GitHub(args.repo, token_from_environment()), plan, actions_token)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
