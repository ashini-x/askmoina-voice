import {describe,expect,it} from "vitest";
import {SYSTEM_INSTRUCTION} from "../src/sessions/assistant-instruction";
import {ASSAMESE_SPEECH_EVALUATION_INSTRUCTION} from "../src/sessions/assamese-speech-evaluation";
import {createRunTemplate,loadSuite,scoreRun,validateRepositorySuites,validateRun} from "../scripts/reality-benchmark.mjs";
describe("M37 Assamese speech evaluation",()=>{
 it("adds dialect humility, language matching, English controls, and correction guidance",()=>{expect(SYSTEM_INSTRUCTION).toContain("ASSAMESE SPEECH EVALUATION CONTRACT");expect(SYSTEM_INSTRUCTION).toContain("never claim one person's preference is the universal Upper Assam standard");expect(SYSTEM_INSTRUCTION).toContain("Preserve conventional English pronunciation");expect(SYSTEM_INSTRUCTION).toContain("Do not argue");expect(ASSAMESE_SPEECH_EVALUATION_INSTRUCTION.join("\n")).toContain("When speech is genuinely unclear");});
 it("ships a 15-case listening suite with English negative controls and word-level feedback",()=>{const s=loadSuite("speech");expect(s.cases.length).toBeGreaterThanOrEqual(15);expect(s.cases.some(c=>c.domain==="english-pronunciation-control")).toBe(true);expect(s.cases.some(c=>c.domain==="word-specific-correction")).toBe(true);expect(s.recording_policy).toContain("without saving audio");});
 it("validates both versioned suites",()=>{const v=validateRepositorySuites();expect(v.ok,v.errors.join("\n")).toBe(true);});
 it("fails the synthetic speech gate when a critical failure is recorded",()=>{const s=loadSuite("speech"),r=createRunTemplate(s);for(const row of r.results)for(const d of s.dimensions)row.ratings[d.id]=2;expect(scoreRun(s,r).passed).toBe(true);r.results[0].critical_failures.push("English negative control mispronounced repeatedly");expect(scoreRun(s,r).passed).toBe(false);});
 it("rejects captured transcripts from score-only files",()=>{const s=loadSuite("speech"),r=createRunTemplate(s);r.transcript="private";expect(validateRun(s,r).some(e=>e.includes("transcript"))).toBe(true);});
});
