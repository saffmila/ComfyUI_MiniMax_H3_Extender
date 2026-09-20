import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
    process.env.H3_EXTENDER_SOURCE || new URL("../web/extender.js", import.meta.url),
    "utf8",
).replace(/^import .*;\r?\n/gm, "");

function makeContext() {
    const rafQueue = [];
    const context = vm.createContext({
        app: { registerExtension() {}, graph: null },
        api: { apiURL(value) { return value; } },
        document: {
            getElementById() { return {}; },
            createElement() { return { dataset: {}, style: { setProperty() {} }, append() {}, addEventListener() {} }; },
        },
        requestAnimationFrame(callback) { rafQueue.push(callback); },
        alert() {},
        console,
        Set,
    });
    vm.runInContext(source, context);
    context.rafQueue = rafQueue;
    return context;
}

test("removing a global picture redraws its slot immediately and once again after the Nodes 2.0 frame", () => {
    const context = makeContext();
    context.node = {
        graph: {
            dirtyCalls: 0,
            setDirtyCanvas() { this.dirtyCalls += 1; },
        },
    };
    context.runtime = {
        refsState: { refs: [{ id: "r1", original_name: "one.png" }, null, null, null, null, null, null, null, null] },
        refsRow: {},
        state: { generation_mode: "ref2va" },
    };

    vm.runInContext(`
        removalPaints = [];
        changeCalls = 0;
        renderReferences = (_node, rt) => {
            removalPaints.push(rt.refsState.refs[0] === null ? "free" : "occupied");
        };
        handleReferenceChange = (_node, _rt, _message) => { changeCalls += 1; };
        projectBusy = () => false;
    `, context);

    vm.runInContext("removeReference(node, runtime, 0)", context);

    assert.equal(context.runtime.refsState.refs[0], null);
    assert.deepEqual(Array.from(vm.runInContext("removalPaints", context)), ["free"]);
    assert.equal(vm.runInContext("changeCalls", context), 1);
    assert.equal(context.rafQueue.length, 1);

    context.rafQueue.shift()();
    assert.deepEqual(Array.from(vm.runInContext("removalPaints", context)), ["free", "free"]);
});
