import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if os.name == "nt":
    git_bash = Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "Git/bin/bash.exe"
    BASH = str(git_bash) if git_bash.is_file() else None
else:
    BASH = shutil.which("bash")


@unittest.skipUnless(BASH, "Bash (Git Bash on Windows) is required")
class InitWordPressTests(unittest.TestCase):
    def run_init(self, active_parent, *, installed=True):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        bin_dir = root / "bin"
        bin_dir.mkdir()
        shutil.copyfile(ROOT / "docker/init-wp.sh", root / "init-wp.sh")
        if installed:
            (root / "wp/wp-content/themes/bricks").mkdir(parents=True)
        commands = {
            "curl": "#!/usr/bin/env bash\nexit 0\n",
            "docker": (
                '#!/usr/bin/env bash\n'
                'printf "%s\\n" "$*" >> "$AUTOBRICKS_TEST_LOG"\n'
                'case "$*" in\n'
                '  *"wpcli option get template") printf "%s\\n" "$AUTOBRICKS_TEST_PARENT" ;;\n'
                'esac\nexit 0\n'
            ),
        }
        for name, contents in commands.items():
            executable = bin_dir / name
            executable.write_text(contents, encoding="utf-8", newline="\n")
            executable.chmod(0o755)
        log = root / "commands.txt"
        env = {**os.environ, "PATH": str(bin_dir) + os.pathsep + os.environ.get("PATH", ""),
               "AUTOBRICKS_TEST_LOG": log.as_posix(), "AUTOBRICKS_TEST_PARENT": active_parent}
        result = subprocess.run([BASH, (root / "init-wp.sh").as_posix()],
                                env=env, capture_output=True, encoding="utf-8", timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = log.read_text(encoding="utf-8")
        self.assertIn("wpcli option get template", calls)
        return calls, result.stdout

    def test_bricks_parent_option_preserves_active_parent_or_child_theme(self):
        calls, _ = self.run_init("bricks")
        self.assertNotIn("theme activate", calls)
        self.assertNotIn("core install", calls)

    def test_installed_bricks_is_activated_when_another_theme_is_active(self):
        calls, _ = self.run_init("twentytwentyfive")
        self.assertIn("wpcli theme activate bricks", calls)

    def test_missing_bricks_is_not_activated(self):
        calls, _ = self.run_init("twentytwentyfive", installed=False)
        self.assertNotIn("theme activate", calls)


if __name__ == "__main__":
    unittest.main()
