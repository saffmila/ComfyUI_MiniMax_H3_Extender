import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
    process.env.H3_EXTENDER_SOURCE || new URL("../web/extender.js", import.meta.url),
    "utf8",
).replace(/^import .*;\r?\n/gm, "");

function makeContext() {
    const document = {
        activeElement: null,
        getElementById() { return {}; },
        createElement() { return { dataset: {}, style: { setProperty() {} }, append() {}, addEventListener() {} }; },
    };
    const context = vm.createContext({
        app: { registerExtension() {}, graph: null },
        api: { apiURL(value) { return value; } },
        document,
        requestAnimationFrame() {},
        alert() {},
        console,
        Set,
        Map,
    });
    vm.runInContext(source, context);
    return context;
}

test("prompt blur no longer rebuilds the entire card list", () => {
    assert.equal(
        source.includes('prompt.addEventListener("blur", () => render(node, runtime))'),
        false,
    );
});

test("Legacy rebuild preserves prompt scroll/caret without forcing DOM focus", () => {
    const context = makeContext();
    context.LiteGraph = { vueNodesMode: false };

    const oldPrompt = {
        dataset: { h3PromptClipId: "clip_7" },
        scrollTop: 486,
        scrollLeft: 12,
        selectionStart: 1280,
        selectionEnd: 1280,
        selectionDirection: "none",
    };
    context.document.activeElement = oldPrompt;

    const promptUiState = new Map();
    context.runtime = {
        root: { isConnected: true, closest() { return null; } },
        cards: {
            querySelectorAll() { return [oldPrompt]; },
        },
        promptUiState,
    };

    vm.runInContext("capturePromptUiState(runtime)", context);
    const saved = promptUiState.get("clip_7");
    assert.equal(saved.scrollTop, 486);
    assert.equal(saved.scrollLeft, 12);
    assert.equal(saved.selectionStart, 1280);
    assert.equal(saved.selectionEnd, 1280);
    assert.equal(saved.focused, true);

    let focusCalls = 0;
    let selectionArgs = null;
    const replacementPrompt = {
        scrollTop: 0,
        scrollLeft: 0,
        focus() {
            focusCalls += 1;
            context.document.activeElement = this;
        },
        setSelectionRange(start, end, direction) {
            selectionArgs = [start, end, direction];
            this.scrollTop = 999;
        },
    };
    context.replacementPrompt = replacementPrompt;

    vm.runInContext('restorePromptUiState(replacementPrompt, runtime, "clip_7")', context);

    assert.equal(focusCalls, 0);
    assert.deepEqual(selectionArgs, [1280, 1280, "none"]);
    assert.equal(replacementPrompt.scrollTop, 486);
    assert.equal(replacementPrompt.scrollLeft, 12);
    assert.equal(context.document.activeElement, oldPrompt);
});

test("Nodes 2.0 rebuild preserves prompt scroll/caret and restores focus", () => {
    const context = makeContext();
    context.LiteGraph = { vueNodesMode: true };

    const oldPrompt = {
        dataset: { h3PromptClipId: "clip_7" },
        scrollTop: 486,
        scrollLeft: 12,
        selectionStart: 1280,
        selectionEnd: 1280,
        selectionDirection: "none",
    };
    context.document.activeElement = oldPrompt;

    const promptUiState = new Map();
    context.runtime = {
        root: { isConnected: true, closest() { return {}; } },
        cards: {
            querySelectorAll() { return [oldPrompt]; },
        },
        promptUiState,
    };

    vm.runInContext("capturePromptUiState(runtime)", context);

    let focusCalls = 0;
    let selectionArgs = null;
    const replacementPrompt = {
        scrollTop: 0,
        scrollLeft: 0,
        focus() {
            focusCalls += 1;
            this.scrollTop = 777;
            context.document.activeElement = this;
        },
        setSelectionRange(start, end, direction) {
            selectionArgs = [start, end, direction];
            this.scrollTop = 999;
        },
    };
    context.replacementPrompt = replacementPrompt;

    vm.runInContext('restorePromptUiState(replacementPrompt, runtime, "clip_7")', context);

    assert.equal(focusCalls, 1);
    assert.deepEqual(selectionArgs, [1280, 1280, "none"]);
    assert.equal(replacementPrompt.scrollTop, 486);
    assert.equal(replacementPrompt.scrollLeft, 12);
    assert.equal(context.document.activeElement, replacementPrompt);
});
