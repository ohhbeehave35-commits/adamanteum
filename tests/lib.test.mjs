import test from 'node:test';
import assert from 'node:assert/strict';
import {category,title,targets,resolver,searchExpression} from '../lib.mjs';
test('separates generated exports and backups from source records',()=>{
 assert.equal(category('GRAPHIFY-EXPORT-X/foo.md'),'generated');
 assert.equal(category('GRAPHIFY-EXPORT-X.bak-old/foo.md'),'archive');
 assert.equal(category('Continuity/record.md'),'records');
});
test('extracts actual wiki and markdown targets, not external URLs',()=>{
 assert.deepEqual(targets('[[Folder/Note#Heading|Alias]] [x](../Other.md) [web](https://example.com/a.md) [[Folder/Note]]'),['Folder/Note','../Other.md']);
});
test('code spans, fenced examples and comments do not create graph links',()=>{
 assert.deepEqual(targets('[[real]] `[[inline]]` ``[[long]] ` tick``\n```md\n[[fenced]]\n```\n~~~\n[x](fake.md)\n~~~\n<!-- [[comment]] -->\n[yes](actual.md)'),['real','actual.md']);
 assert.deepEqual(targets('````\n```\n[[still-code]]\n````\n[[after]]'),['after']);
});
test('resolves relative paths and rejects ambiguous basenames',()=>{
 const resolve=resolver(['A/index.md','A/Note.md','B/Note.md','Home.md']);
 assert.equal(resolve('A/index.md','Note'),'A/Note.md');
 assert.equal(resolve('Home.md','Note'),null);
 assert.equal(resolve('A/index.md','../Home.md'),'Home.md');
 assert.equal(resolve('Home.md','A/Note'),'A/Note.md');
 assert.equal(resolve('Home.md','missing'),null);
});
test('search syntax is quoted and bounded',()=>{
 assert.equal(searchExpression('hello OR "world"'),'\"hello\"* AND \"OR\"* AND \"world\"*');
 assert.equal(searchExpression('***'),'');
 assert.equal(searchExpression(Array(20).fill('a').join(' ')).split(' AND ').length,12);
});
test('title uses actual heading and safe fallback',()=>{
 assert.equal(title('# **Hello**','a.md'),'Hello');
 assert.equal(title('text','A/my-note.md'),'my note');
});
