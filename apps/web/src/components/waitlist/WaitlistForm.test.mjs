import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
const require=createRequire(import.meta.url),ts=require('typescript');
const source=readFileSync(new URL('./WaitlistForm.tsx',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
function fixture(fetcher){
 const hooks=[],requests=[],loaded={exports:{}};let cursor=0;
 const jsx=(type,props)=>({type,props:props??{}});
 vm.runInNewContext(compiled,{module:loaded,exports:loaded.exports,
  FormData:class{constructor(value){this.value=value;}get(key){return this.value[key]??null;}},
  fetch:async(url,options)=>{requests.push({url,...options});return fetcher(url,options);},
  require(name){if(name==='react')return{useState(initial){const i=cursor++;if(!(i in hooks))hooks[i]=initial;return[hooks[i],value=>{hooks[i]=value;}];}};if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='@/components/ui/Button')return{buttonClasses:()=>''};throw Error(name);}});
 const render=()=>{cursor=0;return loaded.exports.WaitlistForm();};
 const submit=()=>render().props.onSubmit({preventDefault(){},currentTarget:{email:'owner@example.com',website:''}});
 return{render,submit,requests};
}
function words(n){if(Array.isArray(n))return n.map(words).join(' ');if(n&&typeof n==='object')return words(n.props.children);return n==null?'':String(n);}
test('the real form submits only on intent and acknowledges only persisted success',async()=>{
 const f=fixture(async()=>Response.json({joined:true}));
 assert.equal(f.requests.length,0);assert.match(words(f.render()),/Join waitlist/);
 await f.submit();assert.equal(f.requests.length,1);assert.equal(f.requests[0].url,'/api/waitlist');
 assert.deepEqual(JSON.parse(f.requests[0].body),{email:'owner@example.com',website:''});
 assert.match(words(f.render()),/You’re on the list/);assert.doesNotMatch(words(f.render()),/sign-in code/);
});
test('rate limits and persistence failures keep the form available without claiming a signup',async()=>{
 for(const status of [429,503]){const f=fixture(async()=>Response.json({error:'private diagnostic'},{status}));await f.submit();const text=words(f.render());assert.doesNotMatch(text,/on the list|private diagnostic/);assert.match(text,status===429?/Too many requests/:/couldn’t save/);}
});
