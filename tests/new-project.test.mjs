import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(
    process.env.H3_EXTENDER_SOURCE || new URL("../web/extender.js", import.meta.url),
    "utf8",
).replace(/^import .*;\r?\n/gm, "");

test("New Project clears project state while preserving global node settings", () => {
    let extension;
    const context = vm.createContext({
        app: { registerExtension(value) { extension = value; }, graph: null },
        api: {},
        document: {
            getElementById() { return {}; },
            createElement() { return { dataset: {}, style: { setProperty() {} }, append() {}, addEventListener() {} }; },
        },
        requestAnimationFrame() {},
        console,
    });
    vm.runInContext(source, context);
    vm.runInContext(`
        notifyWorkflowChanged = () => {};
        captureNativeWorkflowState = () => {};
        randomSeed = () => 123456;
    `, context);

    const widgets = [
        { name: "clips_json", value: "" },
        { name: "refs_json", value: "" },
        { name: "generation_mode", value: "fl2va" },
        { name: "motion_context", value: false },
        { name: "resolution_mode", value: "manual" },
        { name: "width", value: 1216 },
        { name: "height", value: 704 },
        { name: "megapixels", value: 0.9 },
        { name: "codec", value: "H.265 / HEVC" },
    ];
    const oldRef = { id: "a".repeat(64), source_id: "a".repeat(64), original_name: "old.png" };
    const oldClip = {
        id: "old_clip", name: "old", prompt: "old prompt", seed: 9, seed_mode: "fixed",
        duration: 22, validated: true, loras: [{ name: "old.safetensors", strength: 1 }],
        local_refs: { version: 1, images: [{ slot: 1, ref: oldRef }], videos: [], audios: [] },
        first_frame: oldRef, last_frame: oldRef, guides: [{ frame: oldRef, frame_idx: 9 }], first_source: "manual",
    };
    const oldOther = { ...oldClip, id: "other_clip", prompt: "inactive old prompt" };
    const runtime = {
        state: {
            version: 2, generation_mode: "fl2va", motion_context: false,
            causal_lineage: ["old_clip"], load_token: "oldtoken", prompt_pack_signature: "oldpack", resume_nonce: "oldresume",
            clips: [oldClip], mode_clips: { ref2va: [oldOther], fl2va: [oldClip] },
        },
        refsState: { version: 2, refs: [oldRef, ...Array(8).fill(null)] },
        jsonWidget: widgets[0], refsWidget: widgets[1],
        cachedCount: 1, validatedCount: 1,
        cachedClipIds: new Set(["old_clip"]), validatedClipIds: new Set(["old_clip"]),
        computedIndices: new Set([0]), computedClipIds: new Set(["old_clip"]),
        checkpointActive: true, checkpointInterrupted: true, checkpointSnapshotCount: 1,
        continuitySignatures: new Map([["old_clip", "sig"]]), continuitySignatureRequests: new Set(["old_clip"]),
        modeValidationState: { fl2va: new Map([["old_clip", true]]) },
        modeValidationOrder: { fl2va: ["old_clip"] },
        expectedResolution: { width: 1216, height: 704 }, resolvedWidth: 1216, resolvedHeight: 704,
        resolutionGuide: "ref_1", guideSourceWidth: 1000, guideSourceHeight: 700,
        resolutionFallback: true, resolutionMismatch: true, resolutionMirrorActive: true,
        projectResolutionLoaded: true, resolutionInvalidated: true,
        manualWidth: 1216, manualHeight: 704,
        projectName: "Old Project", pendingRefSlot: 3, pendingFrameClip: 0,
        pendingFrameKind: "first", pendingFrameGuideIndex: 0,
        interruptRequested: true, interruptRequestBusy: true,
        cacheStateRestored: false, cacheStateRequestRunning: true,
    };
    const node = {
        widgets,
        properties: { h3_project_name: "Old Project", keep_me: "global" },
        graph: { change() {}, setDirtyCanvas() {} },
    };
    context.runtime = runtime;
    context.node = node;
    vm.runInContext("resetRuntimeForNewProject(node, runtime)", context);

    assert.equal(runtime.state.generation_mode, "fl2va");
    assert.equal(runtime.state.motion_context, false);
    assert.equal(runtime.state.clips.length, 1);
    assert.equal(runtime.state.mode_clips.ref2va.length, 1);
    assert.equal(runtime.state.mode_clips.fl2va.length, 1);
    for (const list of [runtime.state.mode_clips.ref2va, runtime.state.mode_clips.fl2va]) {
        assert.equal(list[0].prompt, "");
        assert.equal(list[0].validated, false);
        assert.deepEqual(Array.from(list[0].loras), []);
        assert.equal(list[0].first_frame, null);
        assert.equal(list[0].last_frame, null);
        assert.equal(list[0].local_refs.images.length, 0);
    }
    assert.ok(runtime.state.load_token);
    assert.equal(runtime.state.prompt_pack_signature, "");
    assert.equal(runtime.state.resume_nonce, "");
    assert.equal(runtime.refsState.refs.filter(Boolean).length, 0);
    assert.equal(runtime.cachedCount, 0);
    assert.equal(runtime.validatedCount, 0);
    assert.equal(runtime.computedClipIds.size, 0);
    assert.equal(runtime.checkpointActive, false);
    assert.equal(runtime.projectName, "");
    assert.equal(node.properties.h3_project_name, undefined);
    assert.equal(node.properties.keep_me, "global");

    // Native/global widget values are intentionally untouched.
    assert.equal(widgets.find(w => w.name === "generation_mode").value, "fl2va");
    assert.equal(widgets.find(w => w.name === "motion_context").value, false);
    assert.equal(widgets.find(w => w.name === "width").value, 1216);
    assert.equal(widgets.find(w => w.name === "height").value, 704);
    assert.equal(widgets.find(w => w.name === "megapixels").value, 0.9);
    assert.equal(widgets.find(w => w.name === "codec").value, "H.265 / HEVC");
    assert.equal(runtime.manualWidth, 1216);
    assert.equal(runtime.manualHeight, 704);
});
