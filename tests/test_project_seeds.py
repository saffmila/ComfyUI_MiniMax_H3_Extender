"""CPU-only tests of portable seed restoration; no ComfyUI/GPU required."""
import ast
import copy
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
tree = ast.parse((ROOT / 'extender.py').read_text())
names = {'_restore_project_generation_seeds', '_generation_mode_from_project_payload', '_normalize_generation_mode'}
ns = {'json': json, 'DEFAULT_SEED_MAX': 2**53 - 1}
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names], type_ignores=[]), 'extender.py', 'exec'), ns)
mode_tree = ast.parse((ROOT / 'fl2va_engine.py').read_text())
exec(compile(ast.Module(body=[n for n in mode_tree.body if isinstance(n, ast.FunctionDef) and n.name == 'normalize_mode'], type_ignores=[]), 'fl2va_engine.py', 'exec'), ns)
ns['_normalize_generation_mode'] = ns['normalize_mode']
restore = ns['_restore_project_generation_seeds']

class ProjectSeeds(unittest.TestCase):
    def test_roundtrip_modes_reorder_and_missing_cache(self):
        for mode, motion in [('ref2va', True), ('ref2va', False), ('fl2va', False)]:
            for behavior in ['fixed', 'increment', 'decrement', 'randomize']:
                with self.subTest(mode=mode, motion=motion, behavior=behavior):
                    cards = [{'id': i, 'seed': 999, 'seed_mode': behavior, 'validated': i == 'a'} for i in ['b', 'a', 'new']]
                    state = {'clips': cards, 'mode_clips': {mode: cards, 'inactive': [{'id': 'a', 'seed': 777}]}}
                    raw = json.dumps(state)
                    live = {'extender': {'generation_mode': mode, 'motion_context': motion, 'clips': cards, 'clips_json': raw, 'settings': {'clips_json': raw}}}
                    before = copy.deepcopy(live)
                    archived = copy.deepcopy(live)
                    manifest = {'segments': [{'clip_id': 'a', 'generation_seed': 0}, {'clip_id': 'b', 'generation_seed': 123}, {'clip_id': 'deleted', 'generation_seed': 5}]}
                    restore(archived, manifest)
                    loaded = json.loads(json.dumps(archived))
                    restore(loaded, manifest)
                    self.assertEqual(live, before)
                    e = loaded['extender']
                    for values in [e['clips'], json.loads(e['clips_json'])['clips'], json.loads(e['settings']['clips_json'])['clips'], json.loads(e['clips_json'])['mode_clips'][mode]]:
                        self.assertEqual([c['seed'] for c in values], [123, 0, 999])
                        self.assertEqual([c['seed_mode'] for c in values], [behavior]*3)
                        self.assertEqual([c['validated'] for c in values], [False, True, False])
                    self.assertEqual(json.loads(e['clips_json'])['mode_clips']['inactive'][0]['seed'], 777)

    def test_legacy_and_invalid_metadata_unchanged(self):
        for seed in [None, True, -1, 2**53, '123']:
            payload = {'extender': {'clips': [{'id': 'a', 'seed': 42}]}}
            before = copy.deepcopy(payload)
            restore(payload, {'segments': [{'clip_id': 'a', 'generation_seed': seed}]})
            self.assertEqual(payload, before)

    def test_recording_in_all_generation_paths(self):
        # Guard wiring: actual sampler seed must be passed into the cache writer.
        for filename, writer in [('extender.py', 'store_fl2va_segment'), ('extender.py', 'join'), ('ref2va_independent.py', 'store_segment')]:
            module = ast.parse((ROOT / filename).read_text())
            calls = [n for n in ast.walk(module) if isinstance(n, ast.Call) and ((isinstance(n.func, ast.Name) and n.func.id == writer) or (isinstance(n.func, ast.Attribute) and n.func.attr == writer))]
            recorded = [n for n in calls if any(k.arg == 'generation_seed' and ast.unparse(k.value) == "cfg['seed']" for k in n.keywords)]
            self.assertEqual(len(recorded), 1, (filename, writer))

if __name__ == '__main__':
    unittest.main()
