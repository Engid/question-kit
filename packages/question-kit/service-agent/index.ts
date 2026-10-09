// @question-kit/service-agent: a lightweight customer-service agent on Jev.
//
// Code runs the company's procedure; Jev reads the customer (what they want, the values a step
// needs, their answers) and makes the procedure's judgment calls (which optional step, if any). No
// LLM. The state is an append-only log of the conversation.

export * from "./service.ts";
export * from "./log.ts";
export * from "./templates.ts";
export * from "./turn.ts";
// The two halves of a turn, for inspecting or driving one by hand: what to read, and what to do next.
export { decide, type Position, position } from "./decide.ts";
export { read, type ReadOptions, type ReadPlan, readPlan } from "./read.ts";
