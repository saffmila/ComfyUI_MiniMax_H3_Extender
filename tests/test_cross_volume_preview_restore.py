"""CPU-only guard for the cross-volume startup preview restore fix."""
import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class CrossVolumePreviewRestore(unittest.TestCase):
    def test_restore_uses_shutil_move_for_rebuilt_preview(self):
        tree = ast.parse((ROOT / "motion_context_disk.py").read_text(encoding="utf-8"))
        fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "_restore_cached_preview_without_decode")
        calls = [n for n in ast.walk(fn) if isinstance(n, ast.Call)]

        move_calls = [
            n for n in calls
            if isinstance(n.func, ast.Attribute)
            and isinstance(n.func.value, ast.Name)
            and n.func.value.id == "shutil"
            and n.func.attr == "move"
            and len(n.args) >= 2
            and ast.unparse(n.args[0]) == "temp_preview"
            and ast.unparse(n.args[1]) == "preview_path"
        ]
        self.assertEqual(len(move_calls), 1)

        bad_replace = [
            n for n in calls
            if isinstance(n.func, ast.Attribute)
            and isinstance(n.func.value, ast.Name)
            and n.func.value.id == "os"
            and n.func.attr == "replace"
            and len(n.args) >= 2
            and ast.unparse(n.args[0]) == "temp_preview"
            and ast.unparse(n.args[1]) == "preview_path"
        ]
        self.assertEqual(bad_replace, [])

    def test_shutil_is_imported(self):
        tree = ast.parse((ROOT / "motion_context_disk.py").read_text(encoding="utf-8"))
        imports = [n for n in tree.body if isinstance(n, ast.Import)]
        self.assertTrue(any(any(alias.name == "shutil" for alias in n.names) for n in imports))

if __name__ == "__main__":
    unittest.main()
