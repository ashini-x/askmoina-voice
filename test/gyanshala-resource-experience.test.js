import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const schema = source("../src/gyanshala-demo/schema.sql");
const backend = source("../src/gyanshala-demo/index.ts");
const app = source("../public/gyanshala-demo/app.js");

describe("Gyanshala campus workflows (interfaces 12–14)", () => {
  it("stores listings, borrow requests, and messages in separate Gyanshala tables", () => {
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS gyanshala_resources");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS gyanshala_resource_requests");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS gyanshala_messages");
    expect(schema).toContain("REFERENCES gyanshala_users(user_id)");
  });

  it("requires an authenticated, completed profile to publish a listing", () => {
    const create = backend.slice(backend.indexOf("async function createResource"), backend.indexOf("async function listMyRequests"));
    expect(create).toContain("getUser(r, e)");
    expect(create).toContain("if (!u)");
    expect(create).toContain("if (u.profile_complete !== 1)");
    expect(create).toContain("INSERT INTO gyanshala_resources");
    expect(create).toContain("owner_id");
    expect(create).toContain('lendingType === "sell" && priceInput < 1');
  });

  it("scopes sent requests to the signed-in student", () => {
    const requests = backend.slice(backend.indexOf("async function listMyRequests"), backend.indexOf("type MessageThreadRow"));
    expect(requests).toContain("getUser(r, e)");
    expect(requests).toContain("WHERE q.requester_id=?");
    expect(requests).toContain("messages_available");
  });

  it("only exposes message threads to a requester or its actual listing owner", () => {
    const threads = backend.slice(backend.indexOf("async function listMessageThreads"), backend.indexOf("async function logout"));
    expect(threads).toContain("q.owner_id IS NOT NULL");
    expect(threads).toContain("(q.requester_id=? OR q.owner_id=?)");
    expect(threads).toContain("recipient_id");
    expect(threads).toContain("sample_listing_no_owner");
  });

  it("wires listing, request history, and message screens into navigation and forms", () => {
    expect(app).toContain("function addResourceScreen()");
    expect(app).toContain("function myRequestsScreen()");
    expect(app).toContain("function messagesScreen()");
    expect(app).toContain("Ask about this item");
    expect(app).toContain("Request this free item");
    expect(app).toContain('form.id === "listing-form"');
    expect(app).toContain('form.id === "thread-message-form"');
    expect(app).toContain('data-action="my-requests"');
    expect(app).toContain('data-action="messages"');
  });
});