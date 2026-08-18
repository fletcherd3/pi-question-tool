/**
 * Regression tests for the flicker workaround: while a question/questionnaire
 * UI is open, the extension must hide pi's working spinner via
 * ctx.ui.setWorkingVisible(false) and restore it afterwards, on every path
 * (answer, cancel, and error). See pi-tui issue #4785: an off-screen spinner
 * ticking at 80ms triggers a full screen redraw per tick.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import registerExtension from "../extensions/index.ts";

type ToolDef = {
	name: string;
	execute: (
		toolCallId: string,
		params: any,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: unknown,
	) => Promise<{ content: { type: string; text: string }[] }>;
};

function registerTools(): Map<string, ToolDef> {
	const tools = new Map<string, ToolDef>();
	registerExtension({ registerTool: (def: ToolDef) => tools.set(def.name, def) } as never);
	return tools;
}

const tools = registerTools();
const question = tools.get("question")!;
const questionnaire = tools.get("questionnaire")!;

/**
 * Build a mock ExtensionContext. Events records the order of
 * setWorkingVisible calls relative to the custom() invocation.
 */
function makeCtx(customResult: () => unknown, mode: "tui" | "print" = "tui") {
	const events: string[] = [];
	const ctx = {
		mode,
		ui: {
			setWorkingVisible: (visible: boolean) => events.push(visible ? "show" : "hide"),
			custom: () => {
				events.push("custom");
				return Promise.resolve().then(customResult);
			},
		},
	};
	return { ctx, events };
}

const QUESTION_PARAMS = {
	question: "Pick one?",
	options: [
		{ label: "A", description: "first" },
		{ label: "B" },
	],
};

const QUESTIONNAIRE_PARAMS = {
	questions: [{ id: "q1", prompt: "Pick one?", options: [{ value: "a", label: "A" }] }],
};

// ---------------------------------------------------------------------------
// question
// ---------------------------------------------------------------------------

test("question: hides working spinner around the custom UI on answer", async () => {
	const { ctx, events } = makeCtx(() => ({ answer: "A", wasCustom: false, index: 1 }));
	const result = await question.execute("t1", QUESTION_PARAMS, undefined, undefined, ctx);
	assert.deepEqual(events, ["hide", "custom", "show"]);
	assert.match(result.content[0].text, /User selected: 1\. A/);
});

test("question: hides working spinner around the custom UI on custom text", async () => {
	const { ctx, events } = makeCtx(() => ({ answer: "free text", wasCustom: true }));
	const result = await question.execute("t1", QUESTION_PARAMS, undefined, undefined, ctx);
	assert.deepEqual(events, ["hide", "custom", "show"]);
	assert.match(result.content[0].text, /User wrote: free text/);
});

test("question: restores working spinner on cancel", async () => {
	const { ctx, events } = makeCtx(() => null);
	const result = await question.execute("t1", QUESTION_PARAMS, undefined, undefined, ctx);
	assert.deepEqual(events, ["hide", "custom", "show"]);
	assert.match(result.content[0].text, /cancelled/);
});

test("question: restores working spinner when the custom UI throws", async () => {
	const { ctx, events } = makeCtx(() => {
		throw new Error("boom");
	});
	await assert.rejects(question.execute("t1", QUESTION_PARAMS, undefined, undefined, ctx), /boom/);
	assert.deepEqual(events, ["hide", "custom", "show"]);
});

test("question: does not touch working spinner in non-TUI mode", async () => {
	const { ctx, events } = makeCtx(() => null, "print");
	const result = await question.execute("t1", QUESTION_PARAMS, undefined, undefined, ctx);
	assert.deepEqual(events, []);
	assert.match(result.content[0].text, /UI not available/);
});

test("question: does not touch working spinner when no options given", async () => {
	const { ctx, events } = makeCtx(() => null);
	const result = await question.execute("t1", { question: "?", options: [] }, undefined, undefined, ctx);
	assert.deepEqual(events, []);
	assert.match(result.content[0].text, /No options/);
});

// ---------------------------------------------------------------------------
// questionnaire
// ---------------------------------------------------------------------------

test("questionnaire: hides working spinner around the custom UI on submit", async () => {
	const { ctx, events } = makeCtx(() => ({
		questions: [],
		answers: [{ id: "q1", value: "a", label: "A", wasCustom: false, index: 1 }],
		cancelled: false,
	}));
	const result = await questionnaire.execute("t1", QUESTIONNAIRE_PARAMS, undefined, undefined, ctx);
	assert.deepEqual(events, ["hide", "custom", "show"]);
	assert.match(result.content[0].text, /user selected: 1\. A/);
});

test("questionnaire: restores working spinner on cancel", async () => {
	const { ctx, events } = makeCtx(() => ({ questions: [], answers: [], cancelled: true }));
	const result = await questionnaire.execute("t1", QUESTIONNAIRE_PARAMS, undefined, undefined, ctx);
	assert.deepEqual(events, ["hide", "custom", "show"]);
	assert.match(result.content[0].text, /cancelled/);
});

test("questionnaire: restores working spinner when the custom UI throws", async () => {
	const { ctx, events } = makeCtx(() => {
		throw new Error("boom");
	});
	await assert.rejects(questionnaire.execute("t1", QUESTIONNAIRE_PARAMS, undefined, undefined, ctx), /boom/);
	assert.deepEqual(events, ["hide", "custom", "show"]);
});

test("questionnaire: does not touch working spinner in non-TUI mode", async () => {
	const { ctx, events } = makeCtx(() => null, "print");
	const result = await questionnaire.execute("t1", QUESTIONNAIRE_PARAMS, undefined, undefined, ctx);
	assert.deepEqual(events, []);
	assert.match(result.content[0].text, /UI not available/);
});

test("questionnaire: does not touch working spinner when no questions given", async () => {
	const { ctx, events } = makeCtx(() => null);
	const result = await questionnaire.execute("t1", { questions: [] }, undefined, undefined, ctx);
	assert.deepEqual(events, []);
	assert.match(result.content[0].text, /No questions/);
});
