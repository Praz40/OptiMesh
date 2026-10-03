import copy
import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "setup_github", Path(__file__).resolve().parents[1] / "setup_github.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PLAN = {
    "labels": [{"name": "area:backend", "color": "123abc", "description": "Backend"}],
    "milestones": [{"title": "M0", "description": "Foundation"}],
    "issues": [{
        "id": "first", "title": "First", "body": "Acceptance criteria",
        "labels": ["area:backend"], "milestone": "M0",
    }],
}


class FakeGitHub:
    def __init__(self, writable=True):
        self.writable = writable
        self.labels = []
        self.milestones = []
        self.issues = []
        self.mutations = []

    def all(self, path):
        return copy.deepcopy({
            "/labels": self.labels, "/milestones?state=all": self.milestones,
            "/issues?state=all": self.issues,
        }[path])

    def request(self, method, path="", body=None):
        if method == "GET":
            return {"permissions": {"push": self.writable}}
        self.mutations.append((method, path, copy.deepcopy(body)))
        if method == "POST":
            row = {**copy.deepcopy(body), "number": 1}
            if path == "/labels":
                self.labels.append(row)
            elif path == "/milestones":
                self.milestones.append(row)
            else:
                row["labels"] = [{"name": name} for name in row["labels"]]
                row["milestone"] = {"number": row["milestone"]}
                self.issues.append(row)
            return row
        return {}


class BootstrapTests(unittest.TestCase):
    def test_repeat_run_does_not_duplicate_or_modify(self):
        client = FakeGitHub()
        module.bootstrap(client, PLAN)
        module.bootstrap(client, PLAN)
        self.assertEqual(len(client.mutations), 3)

    def test_existing_closed_issue_is_not_reopened(self):
        client = FakeGitHub()
        module.bootstrap(client, PLAN)
        client.issues[0]["state"] = "closed"
        module.bootstrap(client, PLAN)
        self.assertEqual(client.issues[0]["state"], "closed")
        self.assertEqual(len(client.mutations), 3)

    def test_read_only_access_does_not_mutate(self):
        client = FakeGitHub(writable=False)
        with self.assertRaisesRegex(RuntimeError, "nothing was changed"):
            module.bootstrap(client, PLAN)
        self.assertEqual(client.mutations, [])

    def test_missing_references_are_rejected(self):
        invalid = copy.deepcopy(PLAN)
        invalid["issues"][0]["labels"] = ["missing"]
        with self.assertRaises(ValueError):
            module.validate(invalid)

    def test_pagination_fetches_second_page(self):
        client = module.GitHub("owner/repo", "unused")
        calls = []
        def request(method, path):
            calls.append(path)
            return list(range(100)) if path.endswith("page=1") else [100]
        client.request = request
        self.assertEqual(len(client.all("/issues?state=all")), 101)
        self.assertEqual(len(calls), 2)


if __name__ == "__main__":
    unittest.main()
