// @vitest-environment jsdom
import {createPinia,setActivePinia} from "pinia";
import {flushPromises,mount} from "@vue/test-utils";
import {beforeEach,describe,expect,it,vi} from "vitest";
import App from "./App.vue";

const storage=()=>{const map=new Map<string,string>();return{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>{map.set(k,v)},removeItem:(k:string)=>{map.delete(k)}};};
let session:ReturnType<typeof storage>;
beforeEach(()=>{session=storage();Object.defineProperty(window,"sessionStorage",{value:session,configurable:true});setActivePinia(createPinia());});

function mockFetch(handler:(url:string,init?:RequestInit)=>Promise<{ok:boolean;status:number;json:()=>Promise<any>}>){vi.stubGlobal("fetch",vi.fn((url:any,init?:any)=>handler(String(url),init)));}

describe("App login flow",()=>{
 it("shows the login panel when no token is saved",async()=>{mockFetch(()=>Promise.resolve({ok:false,status:500,json:async()=>({})}));const wrapper=mount(App,{global:{stubs:{ConnectionStatus:true,LobbyView:true,RoomView:true,CharacterSelectionView:true,SetupRedrawView:true,GameView:true}}});await flushPromises();expect(wrapper.find(".login-card").exists()).toBe(true);});
 it("submits credentials, stores the token in sessionStorage and shows the account name",async()=>{mockFetch((_url,init)=>{const body=JSON.parse(String(init?.body));expect(body).toMatchObject({username:"alice",password:"pw"});return Promise.resolve({ok:true,status:200,json:async()=>({ok:true,userId:"u-1",displayName:"alice",token:"salt.secret"})});});const wrapper=mount(App,{global:{stubs:{ConnectionStatus:true,LobbyView:true,RoomView:true,CharacterSelectionView:true,SetupRedrawView:true,GameView:true}}});await flushPromises();await wrapper.find("input[autocomplete=username]").setValue("alice");await wrapper.find("input[autocomplete=current-password]").setValue("pw");await wrapper.find("form").trigger("submit.prevent");await flushPromises();expect(session.getItem("skb.token")).toBe("salt.secret");expect(wrapper.find(".topbar__account").text()).toContain("alice");});
 it("shows an error for a wrong password and keeps the login panel",async()=>{mockFetch(()=>Promise.resolve({ok:false,status:401,json:async()=>({ok:false,reason:"ACCOUNT_PASSWORD_INVALID"})}));const wrapper=mount(App,{global:{stubs:{ConnectionStatus:true,LobbyView:true,RoomView:true,CharacterSelectionView:true,SetupRedrawView:true,GameView:true}}});await flushPromises();await wrapper.find("input[autocomplete=username]").setValue("alice");await wrapper.find("input[autocomplete=current-password]").setValue("bad");await wrapper.find("form").trigger("submit.prevent");await flushPromises();expect(wrapper.find(".login-card__error").text()).toContain("账号或密码错误");expect(session.getItem("skb.token")).toBeNull();});
});
