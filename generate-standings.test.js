// generate-standings.test.js — Tests for MLB Standings generator

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
const { shortDiv, esc, DIV_ORDER } = require('./generate-standings.js');

describe('shortDiv', () => {
  it('shortens American League divisions', () => {
    assert.equal(shortDiv('American League West'), 'AL West');
    assert.equal(shortDiv('American League East'), 'AL East');
    assert.equal(shortDiv('American League Central'), 'AL Central');
  });

  it('shortens National League divisions', () => {
    assert.equal(shortDiv('National League West'), 'NL West');
    assert.equal(shortDiv('National League East'), 'NL East');
    assert.equal(shortDiv('National League Central'), 'NL Central');
  });
});

describe('DIV_ORDER', () => {
  it('has all 6 divisions', () => {
    assert.equal(DIV_ORDER.length, 6);
  });

  it('starts with AL West', () => {
    assert.equal(DIV_ORDER[0], 'American League West');
  });

  it('has AL before NL', () => {
    const firstNL = DIV_ORDER.findIndex(d => d.startsWith('National'));
    const lastAL = DIV_ORDER.findLastIndex(d => d.startsWith('American'));
    assert.ok(lastAL < firstNL, 'AL divisions should come before NL');
  });
});

describe('esc', () => {
  it('escapes HTML entities', () => {
    assert.equal(esc('<b>"&</b>'), '&lt;b&gt;&quot;&amp;&lt;/b&gt;');
  });
});
