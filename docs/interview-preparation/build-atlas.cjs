// Documentation-only builder. No application startup, credentials or network calls.
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const flows = [
  { id:'overview', title:'The whole project, in four parts', short:'Big picture', intro:'The website asks. The server decides. The database remembers.', file:'architecture-and-flows.md',
    steps:[
      ['A person takes an action','Attendee, organizer or admin','Someone searches, books, publishes or reviews an event. Each role has different permissions.','apps/web/src/components/layout/workspace-navigation.ts'],
      ['The website sends a request','Next.js + React','The screen collects input and shows results. It does not decide whether a payment is genuine or whether stock can be reserved.','apps/web/src/lib/api.ts'],
      ['The API checks and decides','Express business services','The server validates input, checks the user and applies the feature rules. It calls other services only when needed.','apps/api/src/express/app.ts'],
      ['The database keeps the truth','PostgreSQL + Prisma','Users, events, bookings, payments and tickets live here. Transactions and constraints protect important relationships.','packages/database/prisma/schema.prisma']
    ], rules:['Redis helps with speed and AI limits; it is not the inventory authority.','Cloudinary stores images; Brevo sends email; Razorpay handles payments; Groq generates AI text.'] },
  { id:'browse', title:'What happens when I search?', short:'Browse events', intro:'Follow one search from the screen to the event cards.', file:'architecture-and-flows.md',
    steps:[
      ['Enter your preferences','Search, city and category','For example: music events in Delhi. The frontend puts these choices into the API request.','apps/web/src/lib/api.ts'],
      ['Check the request','Validation + HTTP route','The API accepts supported input and passes it to the event service. Public browsing does not require a booking account.','apps/api/src/express/modules/events/events.routes.ts'],
      ['Find matching events','SQL filters + ranking','The service applies filters, a stable ordering and a page size. SQL selects records; Prisma loads their related information.','apps/api/src/modules/events/events.service.ts'],
      ['Return one page','Event summary contract','Each summary includes the event name, image, venue and lowest active ticket price. Missing price is not a free ticket.','apps/api/src/modules/events/events.service.ts'],
      ['Show clear event cards','Reusable React card','The same card design can appear on different pages. Price is stored in paise and formatted into rupees for display.','apps/web/src/components/events/event-card.tsx']
    ], rules:['Server pagination avoids downloading the entire catalog at once.','Related-event cards need the same price fields as ordinary search cards.'] },
  { id:'auth', title:'How does the website know who I am?', short:'Login and roles', intro:'Identity and permission are separate checks.', file:'architecture-and-flows.md',
    steps:[
      ['Sign in','Password or Google','The server verifies the sign-in method. A stored password is hashed, not kept as readable text.','apps/api/src/modules/auth/auth.service.ts'],
      ['Create a session','Access token + refresh session','A signed access token identifies the request. A separate refresh cookie supports renewal; its token hash is stored server-side.','apps/api/src/modules/auth/auth.service.ts'],
      ['Send a protected request','Bearer access token','The frontend attaches the access token. On an expired-token response it can attempt a refresh and retry.','apps/web/src/lib/auth.ts'],
      ['Check role and ownership','Server authorization','A valid user still cannot edit another organizer’s event. Hiding a button is not a security check.','apps/api/src/express/middleware/auth.ts'],
      ['Allow or reject the action','Authorized feature service','The backend performs the permitted action or returns an error. Account status can be checked again on a later request.','apps/api/src/express/app.ts']
    ], rules:['Authentication: who are you? Authorization: may you do this?','JWT contents are signed, not encrypted. The system also uses database session state.'] },
  { id:'booking', title:'How a ticket becomes yours', short:'Booking and payment', intro:'A reservation and a successful payment are different things.', file:'architecture-and-flows.md',
    steps:[
      ['Choose ticket quantities','Booking widget','The browser sends ticket IDs, quantities and an idempotency key. Its displayed total is not trusted as the final charge.','apps/web/src/components/booking/booking-widget.tsx'],
      ['Calculate the real price','Booking service','The server loads active ticket prices and validates the event, sale window and requested quantities.','apps/api/src/modules/bookings/bookings.service.ts'],
      ['Reserve the inventory','Database transaction','Stock is decreased only when enough remains. The booking and stock changes commit together, or roll back together.','apps/api/src/modules/bookings/bookings.service.ts'],
      ['Verify the payment','Razorpay + server checks','The server verifies provider information from checkout verification or a signed webhook. A browser success screen alone is not proof.','apps/api/src/modules/payments/payments.service.ts'],
      ['Confirm and issue tickets','Guarded state transition','A valid confirmation changes the booking and issues tickets once. Repeated messages must not create another set of tickets.','apps/api/src/modules/payments/payments.service.ts']
    ], rules:['If the reservation expires, a guarded transition returns stock.','A repeated request or webhook must not repeat the business outcome.'] },
  { id:'ai', title:'How the assistant finds a useful answer', short:'AI and RAG', intro:'First understand the request. Then find facts. Then answer.', file:'architecture-and-flows.md',
    steps:[
      ['Understand the message','Intent + recent context','A greeting, a mood request and a question about one event are different requests. Recent conversation is kept within a budget.','apps/api/src/modules/ai/ai.service.ts'],
      ['Apply the hard rules','City, date, budget and group size','The assistant turns preferences into validated filters. Similar meaning does not justify ignoring price or availability.','apps/api/src/modules/events/events.service.ts'],
      ['Retrieve relevant facts','SQL + local embeddings','MiniLM produces vectors that help match meaning. Event-specific passages can also be selected using lexical and semantic scores.','apps/api/src/modules/ai/semantic-retrieval.service.ts'],
      ['Generate a grounded reply','Groq receives useful text','Selected text passages and structured facts give the model context. Numeric vectors are used for matching, not as a replacement for those facts.','apps/api/src/modules/ai/retrieval-context.ts'],
      ['Check and display the result','Reply + valid event references','Application checks and live catalog information constrain the result. Clarification or a fallback may be needed instead of a confident guess.','apps/web/src/components/ai/conversation.tsx']
    ], rules:['This is a learning map: an interpretation call may happen before retrieval.','RAG does not fine-tune the model, remove token limits or guarantee a correct answer.'] },
  { id:'delivery', title:'How code reaches the website', short:'GitHub and hosting', intro:'GitHub checks and hosting deployments are related, but separate.', file:'architecture-and-flows.md',
    steps:[
      ['Save and commit code','Your working copy','A commit records a revision. Pushing it publishes that revision to the remote repository.','package.json'],
      ['Push to GitHub','Repository history','GitHub stores the code and study files. Other people or AI tools can read the learning guide from this revision.','.github/workflows/ci.yml'],
      ['Run automated checks','GitHub Actions CI','Lint, types, tests and build checks examine a revision. One failed step can fail the job and stop later steps.','.github/workflows/ci.yml'],
      ['Deploy through hosting','Vercel + Render','Hosting services build and run the frontend and API using their configuration. Do not assume the diagram means CI always gates deployment.','docs/deployment.md'],
      ['Use the live application','Browser + hosted API','Runtime health also depends on environment settings, database access and external providers. A green check is not a runtime trace.','apps/api/src/main.ts']
    ], rules:['A CI failure does not mean all individual tests failed.','A passing CI run does not by itself prove that the latest deployment is healthy.'] }
];
const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
function wrap(text, limit) { const out=[]; let line=''; for(const word of text.split(' ')){ if((line+' '+word).trim().length>limit&&line){out.push(line);line=word;}else line=(line+' '+word).trim();}if(line)out.push(line);return out; }
function textLines(text,x,y,limit,size,color,weight=400) { return wrap(text,limit).map((line,i)=>`<text x="${x}" y="${y+i*(size*1.5)}" fill="${color}" font-size="${size}" font-weight="${weight}">${esc(line)}</text>`).join(''); }
function svg(flow) {
 const n=flow.steps.length, gap=22, left=42, width=1216, cw=(width-left*2-gap*(n-1))/n;
 const cards=flow.steps.map((s,i)=>{const x=left+i*(cw+gap);return `<g><rect x="${x}" y="198" width="${cw}" height="208" rx="18" fill="white" stroke="#dce3ee"/><circle cx="${x+30}" cy="230" r="17" fill="${i===n-1?'#137b6e':'#315adc'}"/><text x="${x+30}" y="236" text-anchor="middle" fill="white" font-size="15" font-weight="700">${i+1}</text>${textLines(s[0],x+20,276,Math.floor(cw/10),20,'#14233e',650)}${textLines(s[1],x+20,350,Math.floor(cw/8),14,'#53637b')}${i<n-1?`<path d="M ${x+cw+4} 300 H ${x+cw+gap-5}" stroke="#8797b3" stroke-width="2" marker-end="url(#arrow)"/>`:''}</g>`;}).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="1216" height="620" viewBox="0 0 1216 620" role="img" aria-labelledby="title desc"><title id="title">${esc(flow.title)}</title><desc id="desc">${esc(flow.steps.map((s,i)=>`${i+1}. ${s[0]}: ${s[1]}`).join('. '))}</desc><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto"><path d="M0,0 L6,3.5 L0,7" fill="none" stroke="#8797b3" stroke-width="1.5"/></marker></defs><rect width="1216" height="620" rx="22" fill="#f3f6fc"/><g font-family="Segoe UI,Arial,sans-serif"><text x="42" y="51" fill="#315adc" font-size="13" font-weight="700" letter-spacing="2">EVENTPOINT / LEARN THE FLOW</text><text x="42" y="104" fill="#14233e" font-size="34" font-weight="700">${esc(flow.title)}</text><text x="42" y="143" fill="#53637b" font-size="18">${esc(flow.intro)}</text>${cards}<rect x="42" y="445" width="1132" height="64" rx="13" fill="#e7eefc"/><text x="62" y="471" fill="#2448ae" font-size="12" font-weight="700" letter-spacing="1">REMEMBER</text>${textLines(flow.rules[0],62,495,115,15,'#273d65')}<text x="42" y="556" fill="#53637b" font-size="15">${esc(flow.rules[1])}</text><text x="42" y="592" fill="#64748b" font-size="12">Source-linked learning diagram • Each step is explained in the interactive atlas • 22 October 2026</text></g></svg>`;
}
const visualDir=path.join(dir,'visuals');fs.mkdirSync(visualDir,{recursive:true});
for(const f of flows){ f.svg=svg(f);f.mermaid='flowchart TD\n'+f.steps.map((s,i)=>`  S${i}["${i+1}. ${s[0]}<br/>${s[1]}"]`).join('\n')+'\n'+f.steps.slice(1).map((_,i)=>`  S${i} --> S${i+1}`).join('\n');fs.writeFileSync(path.join(visualDir,f.id+'.svg'),f.svg);fs.writeFileSync(path.join(visualDir,f.id+'.mmd'),f.mermaid+'\n'); }
const technologyRows=fs.readFileSync(path.join(dir,'technology-choices.md'),'utf8').split(/\r?\n/).filter(l=>l.startsWith('| ')&&l.split('|').length===7).slice(1).map(l=>l.split('|').slice(1,-1).map(x=>x.trim().replaceAll('`','')));
const roadmap=fs.readFileSync(path.join(dir,'interview-roadmap.md'),'utf8').split(/\r?\n/).filter(l=>/^\| \d+ \|/.test(l)).map(l=>l.split('|').slice(1,-1).map(x=>x.trim())).filter(row=>row.length===5);
const glossary=fs.readFileSync(path.join(dir,'README.md'),'utf8').split(/\r?\n/).filter(l=>l.startsWith('| ')&&l.split('|').length===4&&!l.startsWith('| Term')).map(l=>l.split('|').slice(1,-1).map(x=>x.trim()));
const data={flows,technologyRows,roadmap,glossary};
fs.writeFileSync(path.join(visualDir,'atlas-data.json'),JSON.stringify(data,null,2)+'\n');
const template=fs.readFileSync(path.join(visualDir,'atlas-template.html'),'utf8');
fs.writeFileSync(path.join(dir,'index.html'),template.replace('__ATLAS_DATA__',JSON.stringify(data).replaceAll('<','\\u003c')));
console.log(JSON.stringify({visualFlows:flows.length,technologyRows:technologyRows.length,interviewTopics:roadmap.length,glossaryTerms:glossary.length}));
