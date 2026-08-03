import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {afterEach,beforeAll,describe,expect,it} from "vitest";
import {loadFrozenRuleset} from "../ruleset/loadRuleset.js";
import type {LoadedRuleset} from "../ruleset/types.js";
import {JsonPersistence} from "./persistence.js";
import {RoomService} from "./roomService.js";

let ruleset:LoadedRuleset;const dirs:string[]=[];
beforeAll(async()=>{ruleset=await loadFrozenRuleset(resolve(import.meta.dirname,"../../../rulesets/v1.3.4"));});
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function rooms(){const dir=await mkdtemp(join(tmpdir(),"skb-account-")),instance=new RoomService(ruleset,new JsonPersistence(join(dir,"state.json")));dirs.push(dir);await instance.restore();return{instance,dir};}

describe("account login/register identity",()=>{
 it("registers a new account and logs back in with the same userId",async()=>{const {instance}=await rooms();
  const first=instance.loginOrRegister("测试玩家","secret123");
  expect(first.ok).toBe(true);if(!first.ok)return;expect(first.created).toBe(true);expect(first.token).toContain(".");
  const second=instance.loginOrRegister("测试玩家","secret123");
  expect(second.ok).toBe(true);if(!second.ok)return;expect(second.created).toBe(false);expect(second.userId).toBe(first.userId);expect(second.token).not.toBe(first.token);
  expect(instance.resolveSession(second.token)).toMatchObject({userId:first.userId,displayName:"测试玩家"});
 });
 it("rejects a wrong password and normalizes the username",async()=>{const {instance}=await rooms();
  const created=instance.loginOrRegister("PlayerOne","pass-1");expect(created.ok).toBe(true);
  const wrong=instance.loginOrRegister("  playerone ","pass-2");expect(wrong).toEqual({ok:false,reason:"ACCOUNT_PASSWORD_INVALID"});
  const valid=instance.loginOrRegister("  playerone ","pass-1");expect(valid.ok).toBe(true);if(valid.ok)expect(valid.userId).toBe(created.ok?created.userId:null);
 });
 it("rejects invalid usernames",async()=>{const {instance}=await rooms();expect(instance.loginOrRegister("x","p")).toEqual({ok:false,reason:"USERNAME_INVALID"});expect(instance.loginOrRegister("a".repeat(25),"p")).toEqual({ok:false,reason:"USERNAME_INVALID"});});
 it("never stores the plaintext password",async()=>{const {instance}=await rooms();instance.loginOrRegister("alice","hunter2hunter2");const raw=JSON.stringify(Object.fromEntries(instance.accounts));expect(raw).not.toContain("hunter2hunter2");expect(raw).toContain("passwordHash");});
 it("persists accounts across restore",async()=>{const {instance,dir}=await rooms();const created=instance.loginOrRegister("persist-user","pw-123");if(!created.ok)return;await instance.persist();
  const restored=new RoomService(ruleset,new JsonPersistence(join(dir,"state.json")));await restored.restore();
  const again=restored.loginOrRegister("persist-user","pw-123");expect(again.ok).toBe(true);if(again.ok)expect(again.userId).toBe(created.userId);
 });
});
