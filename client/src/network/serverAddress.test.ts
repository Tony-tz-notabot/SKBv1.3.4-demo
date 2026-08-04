import {describe,expect,it} from "vitest";
import {resolveApiBase} from "./serverAddress";

describe("resolveApiBase",()=>{
 it("derives an http api base from a ws url",()=>{
  expect(resolveApiBase("ws://47.100.1.2:8787/ws")).toBe("http://47.100.1.2:8787");
 });
 it("derives https from wss",()=>{
  expect(resolveApiBase("wss://skb.example.com/ws")).toBe("https://skb.example.com");
 });
 it("returns an empty base when no server is configured (same-origin mode)",()=>{
  expect(resolveApiBase(undefined)).toBe("");
  expect(resolveApiBase("")).toBe("");
 });
 it("tolerates invalid input",()=>{
  expect(resolveApiBase("not a url")).toBe("");
 });
});
