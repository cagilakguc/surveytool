import assert from "node:assert/strict"
import handler from "../api/feedback.ts"
import { feedbackIssueUrl, parseFeedback } from "../src/lib/feedback.ts"

const valid = { tone: "positive", topic: "GIS Export", message: "The line heights are preserved correctly.", email: "reader@example.com" }
assert.deepEqual(parseFeedback(valid), valid)
for (const value of [null, [], {}, {...valid,tone:"unknown"}, {...valid,topic:"unknown"}, {...valid,message:"no"}, {...valid,message:"x".repeat(2001)}, {...valid,email:"invalid"}]) assert.throws(() => parseFeedback(value))
assert.equal(parseFeedback({...valid,message:"  A useful tool  ",email:""}).message,"A useful tool")
const issue = new URL(feedbackIssueUrl({...valid,message:"Levels & codes: <test>\nTürkçe feedback"}))
assert.equal(issue.origin,"https://github.com")
assert.equal(issue.pathname,"/cagilakguc/surveytool/issues/new")
assert(issue.searchParams.get("body").includes("Levels & codes: <test>\nTürkçe feedback"))
assert(!issue.toString().includes("reader%40example.com"),"Email must never be included in a public issue")

function response() {
  return { code:200,headers:{},body:null,setHeader(k,v){this.headers[k]=v;return this},status(code){this.code=code;return this},json(body){this.body=body;return this} }
}
async function request(method,body=valid,headers={}) {
  const res=response()
  await handler({method,body,headers:{"content-type":"application/json",...headers}},res)
  return res
}
delete process.env.SUPABASE_URL
delete process.env.VITE_SUPABASE_URL
delete process.env.SUPABASE_SECRET_KEY
assert.deepEqual((await request("GET")).body,{available:false})
assert.equal((await request("DELETE")).code,405)
assert.equal((await request("POST",valid,{"content-type":"text/plain"})).code,415)
assert.equal((await request("POST",valid,{"content-length":"9000"})).code,413)
assert.equal((await request("POST",{...valid,message:""})).code,400)
assert.equal((await request("POST")).code,503,"Missing delivery configuration must never report success")

process.env.SUPABASE_URL="https://feedback-test.supabase.co"
process.env.SUPABASE_SECRET_KEY="test-service-key"
let publicBucket=true
let exists=true
let failUpload=false
let uploads=0
let stored=null
const originalFetch=globalThis.fetch
globalThis.fetch=async(input,options={})=>{
  const url=new URL(typeof input==="string"?input:input.url)
  assert.equal(url.host,"feedback-test.supabase.co")
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}})
  if(url.pathname==="/storage/v1/bucket/site-feedback") return exists?json({id:"site-feedback",name:"site-feedback",public:publicBucket}):json({statusCode:404,error:"not_found",message:"Bucket not found"},404)
  if(url.pathname==="/storage/v1/bucket") {
    const config=JSON.parse(options.body)
    assert.equal(config.public,false)
    assert.deepEqual(config.allowed_mime_types,["application/json"])
    exists=true;publicBucket=false
    return json({name:"site-feedback"})
  }
  if(url.pathname.startsWith("/storage/v1/object/site-feedback/")) {
    uploads++
    stored=JSON.parse(Buffer.from(options.body).toString())
    if(failUpload)return json({statusCode:500,message:"Storage unavailable"},500)
    return json({Key:url.pathname})
  }
  throw new Error("Unexpected storage request: "+url.pathname)
}
try {
  assert.deepEqual((await request("GET")).body,{available:true})
  assert.equal((await request("POST")).code,503,"A public bucket must not receive private feedback")
  assert.equal(uploads,0)
  publicBucket=false;exists=false
  const sent=await request("POST")
  assert.equal(sent.code,201)
  assert.equal(sent.body.received,true)
  assert.equal(stored.message,valid.message)
  assert.equal(stored.email,valid.email)
  assert.equal(stored.tone,"positive")
  assert.equal(stored.topic,"GIS Export")
  assert.equal(stored.ip,undefined)
  assert.equal(stored.id,sent.body.id)
  publicBucket=true
  const before=uploads
  assert.equal((await request("POST")).code,503)
  assert.equal(uploads,before,"A bucket made public after setup must not receive private feedback")
  publicBucket=false
  failUpload=true
  const failed=await request("POST",{...valid,tone:"negative"})
  assert.equal(failed.code,503)
  assert.notEqual(failed.body.received,true,"A failed write must not be acknowledged as received")
  failUpload=false
  for(let n=0;n<5;n++) assert.equal((await request("POST",valid,{"x-vercel-forwarded-for":"192.0.2.99"})).code,201)
  assert.equal((await request("POST",valid,{"x-vercel-forwarded-for":"192.0.2.99"})).code,429)
} finally { globalThis.fetch=originalFetch }
console.log("Feedback validation, public-link privacy, private storage, delivery failures and submission limits passed.")
