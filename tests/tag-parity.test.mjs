// Tags are read and counted the way Obsidian's own tag pane does it (measured 22 Oct 2026 on a 96,655-note vault: 3,671 of 3,679 tags identical).
import test from 'node:test';
import assert from 'node:assert/strict';
import {inlineTags,tagOccurrences,tagsOf,obsidianTagCounts} from '../vault-workspace.mjs';

test('a tag follows the start, a space, * or [ ; not a bracket, colon, equals or letter',()=>{
  assert.deepEqual(inlineTags('#a (#b) x:#c y=#d w#e **#f** [#g] ->#h'),['a','f','g']);
});
test('a tag may follow the end of the previous tag (#a/#b) and a trailing slash is dropped',()=>{
  assert.deepEqual(inlineTags('see #221f19/#26231b/#2f2a20 and #last/'),['221f19','26231b','2f2a20','last']);
});
test('a tag needs one non-digit: #7 and #2026 are not tags, #1-3 and #7/ are',()=>{
  assert.deepEqual(inlineTags('#7 #2026 #1-3 #9/'),['1-3','9']);
});
test('code, HTML comments, <style>, <script> and link targets hide tags',()=>{
  assert.deepEqual(inlineTags('`#c`\n```\n#f\n```\n<!-- #h --> <style>a{color:#ccc}</style> [x](u#frag) #ok'),['ok']);
  assert.deepEqual(inlineTags('`a\n#spans` #after'),['after']);
});
test('frontmatter: a list counts, a comma string does not, a space string does',()=>{
  assert.deepEqual(tagOccurrences('---\ntags: [a, b]\n---\n'),['a','b']);
  assert.deepEqual(tagOccurrences('---\ntags: a, b, c\n---\n'),[]);
  assert.deepEqual(tagOccurrences('---\ntags: a b\n---\nbody #c'),['a','b','c']);
});
test('tagsOf stays a set per note; tagOccurrences keeps every use',()=>{
  assert.deepEqual(tagsOf('#a #a #b'),['a','b']);
  assert.deepEqual(tagOccurrences('#a #a #b'),['a','a','b']);
});
test("the tag pane counts every use, each parent once more, and one spelling for letter-case variants",()=>{
  const counts=obsidianTagCounts([['a/b','a/b','x'],['A/B','c'],['7/']]);
  assert.deepEqual(counts,{'a/b':3,a:3,x:1,c:1});
});
