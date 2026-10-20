import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const schema = source("../src/gyanshala-demo/schema.sql");
const backend = source("../src/gyanshala-demo/index.ts");
const app = source("../public/gyanshala-demo/app.js");

describe("Gyanshala campus workflows (interfaces 7–15)", () => {
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

  it("stores pickup points, community posts, and per-student interest separately", () => {
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS gyanshala_pickup_points");
    expect(schema).toContain("map_x INTEGER NOT NULL CHECK (map_x BETWEEN 5 AND 95)");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS gyanshala_community_posts");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS gyanshala_community_interests");
    expect(schema).toContain("PRIMARY KEY (post_id, user_id)");
  });

  it("protects pickup and community reads and requires real account ownership for updates", () => {
    const pickup = backend.slice(backend.indexOf("async function listPickupLocations"), backend.indexOf("type CommunityPostRow"));
    const community = backend.slice(backend.indexOf("async function listCommunityPosts"), backend.indexOf("async function logout"));
    expect(pickup).toContain("getUser(r,e)");
    expect(pickup).toContain("profile_complete!==1");
    expect(community).toContain("getUser(r,e)");
    expect(community).toContain("INSERT INTO gyanshala_community_posts");
    expect(community).toContain("INSERT INTO gyanshala_community_interests");
    expect(community).toContain("post.owner_id!==u.user_id");
  });

  it("connects the pickup map and community board to live APIs and reachable navigation", () => {
    expect(backend).toContain('p === API + "/pickup-locations"');
    expect(backend).toContain('p === API + "/community/posts"');
    expect(app).toContain("function pickupMapScreen()");
    expect(app).toContain("function communityScreen()");
    expect(app).toContain("This is an illustrative campus schematic, not live GPS navigation");
    expect(app).toContain('form.id === "community-post-form"');
    expect(app).toContain('data-action="community-interest"');
    expect(app).toContain('data-action="close-community-post"');
    expect(app).toContain('id="mobile-more-menu"');
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