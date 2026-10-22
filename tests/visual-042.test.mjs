import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const read=name=>fs.readFileSync(new URL(name,root),'utf8');
// The eight screens the owner approved on 21 Oct 2026 (12:02 ET). Each entry is a marker that must stay in the shipped CSS or HTML.
const approved=[
 [1,'css',/@media\(min-width:781px\)\{\.graph-bottom\{bottom:80px\}\.atlas-tools\{bottom:124px\}#legend\{bottom:62px\}\}/],
 [2,'css',/@media\(max-width:780px\)\{\.direction-key\{display:none\}\.atlas-tools\{max-width:calc\(100% - 150px\);bottom:10px\}/],
 [3,'css',/\.result small,\.section-title,\.eyebrow,#status,\.places button,#places-list p,\.graph-bottom span,\.direction-key\{font-size:12px\}/],
 [4,'html',/id="quick-open"[^>]*>⌕ Search <span class="shortcut">/],
 [4,'css',/#quick-open\{min-height:36px;padding:6px 14px;font-size:13px\}/],
 [5,'css',/\.project-map::after\{content:"Choose a project folder and press Scan project\. The map of its code appears here\."/],
 [6,'css',/\.notebook-layout \[data-vault-save\]\{margin-bottom:16px\}/],
 [7,'css',/body\[data-theme=ivory\] \.search\{background:#fff;border-color:#8893ad\}/],
 [8,'css',/\.workspace-switcher\{overflow-x:auto;scrollbar-width:none\}\.workspace-switcher button\{white-space:nowrap/]
];
const missing=(css,html)=>approved.filter(([,kind,re])=>!re.test(kind==='css'?css:html)).map(([n])=>n);
test('the eight approved visual changes are present in the shipped CSS and HTML',()=>{
 assert.deepEqual(missing(read('dist/style.css'),read('dist/index.html')),[]);
});
test('the check detects a missing change (each approved change is guarded on its own)',()=>{
 const css=read('dist/style.css'),html=read('dist/index.html');
 assert.deepEqual(missing(css.replace('.project-map::after{','.project-map-gone::after{'),html),[5]);
 assert.deepEqual(missing(css,html.replace('⌕ Search <span','⌕ <span')),[4]);
 assert.deepEqual(missing(css.replace('@media(max-width:780px){.workspace-switcher{overflow-x:auto','@media(max-width:780px){.workspace-switcher{x:auto'),html),[8]);
});
test('the interface themes file is unchanged by the visual pass',()=>{
 const baseline=JSON.parse(read('tests/visual-baseline-04.json'));
 assert.equal(Object.keys(baseline).sort().join(),'dist/style.css,dist/themes.css');
});
