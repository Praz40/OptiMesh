# GitHub issues, labels and milestones

[.github/project-plan.json](../.github/project-plan.json) defines **17 issues, 6 milestones and 13 labels** with acceptance criteria. No due dates or GitHub assignees are invented.

The backlog is published as issues #2–#18. To re-synchronize labels, milestones and issues, use a user account or fine-grained token that has repository access, metadata read and Issues read/write:

```sh
python scripts/setup_github.py --repo Praz40/OptiMesh --dry-run
gh auth login
python scripts/setup_github.py --repo Praz40/OptiMesh
```

The script accepts GH_TOKEN/GITHUB_TOKEN or uses an existing gh login. Never put a token in source or command arguments. It checks write access before mutation, paginates results and uses stable markers to avoid duplicate issues. Existing issue state/body and extra human-added labels are preserved; planned labels and milestones are synchronized.

Alternatively, once the setup workflow exists on the default branch, run **Actions -> Set up GitHub project -> Run workflow**. The workflow uses its own repository-scoped issues:write token and serializes runs.

CodeRabbit uses the required root filename `.coderabbit.yaml` (with a leading dot). A repository owner must install/enable the CodeRabbit GitHub app for actual PR reviews; the YAML alone does not install it. It reviews develop, release/* and main.
