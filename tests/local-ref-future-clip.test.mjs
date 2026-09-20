import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
    process.env.H3_EXTENDER_SOURCE || new URL("../web/extender.js", import.meta.url),
    "utf8",
).replace(/^import .*;\r?\n/gm, "");

function makeContext() {
    const context = vm.createContext({
        app: { registerExtension() {}, graph: null },
        api: { apiURL(value) { return value; } },
        document: {
            getElementById() { return {}; },
            createElement() { return { dataset: {}, style: { setProperty() {} }, append() {}, addEventListener() {} }; },
        },
        requestAnimationFrame() {},
        alert() {},
        console,
        Set,
    });
    vm.runInContext(source, context);
    return context;
}

test("physical cache detection keeps causal future cards distinct from generated clips", () => {
    const context = makeContext();
    context.runtime = {
        state: { generation_mode: "ref2va", motion_context: true },
        cachedCount: 2,
        cachedClipIds: new Set(),
    };
    context.clips = [{ id: "c1" }, { id: "c2" }, { id: "c3" }];
    assert.equal(vm.runInContext("clipHasPhysicalCache(runtime, clips[0], 0)", context), true);
    assert.equal(vm.runInContext("clipHasPhysicalCache(runtime, clips[1], 1)", context), true);
    assert.equal(vm.runInContext("clipHasPhysicalCache(runtime, clips[2], 2)", context), false);

    context.runtime.state.motion_context = false;
    context.runtime.cachedClipIds = new Set(["c3"]);
    assert.equal(vm.runInContext("clipHasPhysicalCache(runtime, clips[0], 0)", context), false);
    assert.equal(vm.runInContext("clipHasPhysicalCache(runtime, clips[2], 2)", context), true);
});

test("local ref mutation on an ungenerated causal clip does not invalidate a nonexistent disk segment", async () => {
    const context = makeContext();
    context.node = { id: 42 };
    context.runtime = {
        state: {
            generation_mode: "ref2va",
            motion_context: true,
            clips: [
                { id: "c1", validated: true },
                { id: "c2", validated: true },
                { id: "c3", validated: false },
            ],
        },
        cachedCount: 2,
        computedIndices: new Set(),
        validatedClipIds: new Set(["c1", "c2"]),
        validatedCount: 2,
    };
    vm.runInContext(`
        persistCalls = 0;
        persistLocalRefInvalidation = async () => { persistCalls += 1; return true; };
    `, context);

    const ok = await vm.runInContext("prepareLocalRefMutation(node, runtime, 2)", context);
    assert.equal(ok, true);
    assert.equal(vm.runInContext("persistCalls", context), 0);
    assert.equal(context.runtime.state.clips[0].validated, true);
    assert.equal(context.runtime.state.clips[1].validated, true);
    assert.equal(context.runtime.state.clips[2].validated, false);
});

test("local ref mutation on an existing causal cache still persists invalidation", async () => {
    const context = makeContext();
    context.node = { id: 42 };
    context.runtime = {
        state: {
            generation_mode: "ref2va",
            motion_context: true,
            clips: [
                { id: "c1", validated: true },
                { id: "c2", validated: true },
                { id: "c3", validated: false },
            ],
        },
        cachedCount: 2,
        computedIndices: new Set(),
        validatedClipIds: new Set(["c1", "c2"]),
        validatedCount: 2,
    };
    vm.runInContext(`
        persistCalls = 0;
        persistLocalRefInvalidation = async () => { persistCalls += 1; return true; };
    `, context);

    const ok = await vm.runInContext("prepareLocalRefMutation(node, runtime, 1)", context);
    assert.equal(ok, true);
    assert.equal(vm.runInContext("persistCalls", context), 1);
    assert.equal(context.runtime.state.clips[0].validated, true);
    assert.equal(context.runtime.state.clips[1].validated, false);
    assert.equal(context.runtime.state.clips[2].validated, false);
});
