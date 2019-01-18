const asyncHooks = require('async_hooks');
const fs = require('fs');
const util = require('util');
const co = require('..');
const rawCo = require('co');
const {expect} = require('chai');

function debug(...args) {
  fs.writeSync(process.stdout.fd, `${util.format(...args)}\n`);
}

let map = {};
let root = null;
const hooks = asyncHooks.createHook({
  init (asyncId, type, triggerId) {
    if (!root) {
      root = asyncId;
      map[root] = root;
    } else {
      map[asyncId] = triggerId;
    }
  }
});

const asyncIdMatchRoot = id => {
  let rt = id;
  const path = [id];
  while (![root, undefined].includes(rt)) {
    rt = map[rt];
    path.push(rt);
  }
  debug('path:', path.join('-->'));
  return rt === root;
};

let BATCH_SIZE = 3;
const simpleQueue = [];
const execQueue = (len = BATCH_SIZE) => {
  const slice = simpleQueue.splice(0, len);
  if (slice.length) {
    slice.forEach(fn => fn());
  }
};
const addQueue = fn => {
  const p = {};
  const promise = new Promise((resolve, reject) => Object.assign(p, {resolve, reject}));
  const len = simpleQueue.push(() => p.resolve(fn()));
  if (len === BATCH_SIZE) {
    execQueue();
  }
  return promise;
};

const timer = setInterval(execQueue, 20);

describe('async-scope', () => {
  after(() => clearInterval(timer));
  beforeEach(() => {
    map = {};
    root = null;
    hooks.enable();
  });
  afterEach(() => {
    hooks.disable();
  });
  describe('queue', () => {
    it('raw co', () => {
      const startEid = asyncHooks.executionAsyncId();
      const startTid = asyncHooks.triggerAsyncId();
      let lastEid;
      let lastTid;

      const fn = () => {
        const eid = asyncHooks.executionAsyncId();
        const tid = asyncHooks.triggerAsyncId();
        expect(eid).to.be.a('Number').that.equal(startEid);
        expect(tid).to.be.an('Number').that.equal(startTid);
        expect(map).to.have.property(eid).that.equal(tid);
      };
      const independent = () => {
        const eid = asyncHooks.executionAsyncId();
        expect(eid).to.be.a('Number');
        expect(map).to.not.have.property(eid);
      };

      const assertAsyncScope = () => {
        expect(asyncHooks.triggerAsyncId()).to.gt(lastEid);
        lastTid = asyncHooks.triggerAsyncId();
        lastEid = asyncHooks.executionAsyncId();
      };

      return rawCo(function * () {
        lastEid = asyncHooks.executionAsyncId();
        lastTid = asyncHooks.triggerAsyncId();
        expect(lastTid).to.equal(startTid);
        yield [
          addQueue(fn),
          addQueue(fn),
          addQueue(fn)
        ];
        for (let i = 0; i <= BATCH_SIZE; i++) {
          assertAsyncScope();
          yield addQueue(independent);
        }
        assertAsyncScope();
      });
    });

    it('wrapped co', () => {
      const startEid = asyncHooks.executionAsyncId();
      let coEid;
      let coTid;
      let genCalledTimes = 0;

      const fn = () => {
        const eid = asyncHooks.executionAsyncId();
        const tid = asyncHooks.triggerAsyncId();
        expect(eid).to.be.a('Number');
        expect(tid).to.be.an('Number').that.equal(startEid);
        expect(map).to.have.property(eid).that.equal(tid);
      };
      const independent = () => {
        const eid = asyncHooks.executionAsyncId();
        // const tid = asyncHooks.triggerAsyncId();
        expect(eid).to.be.a('Number');
        // expect(tid).to.be.an('Number').that.equal(coEid);
        // expect(map).to.not.have.property(eid);
      };

      const assertAsyncScope = (lastTid = coTid, lastEid = coEid) => {
        expect(asyncHooks.triggerAsyncId()).to.equal(lastTid);
        expect(asyncHooks.executionAsyncId()).to.equal(lastEid);
      };

      const genFn = function * () {
        genCalledTimes++;
        const eid = asyncHooks.executionAsyncId();
        expect(asyncIdMatchRoot(eid)).to.equal(true);
        for (let i = 0; i <= BATCH_SIZE; i++) {
          // assertAsyncScope();
          yield addQueue(independent);
          const eid = asyncHooks.executionAsyncId();
          expect(asyncIdMatchRoot(eid)).to.equal(true);
        }
      };

      return co(function * () {
        coEid = asyncHooks.executionAsyncId();
        coTid = asyncHooks.triggerAsyncId();
        expect(coTid).to.equal(startEid);
        let i = 0;
        expect(asyncIdMatchRoot(coEid)).to.equal(true);
        yield [
          addQueue(fn),
          addQueue(fn),
          addQueue(fn)
        ];
        for (let i = 0; i <= BATCH_SIZE; i++) {
          assertAsyncScope();
          yield addQueue(independent);
        }
        assertAsyncScope();

        yield * genFn();
        i++;
        assertAsyncScope();

        yield genFn();
        i++;
        assertAsyncScope();

        yield [
          genFn(),
          genFn,
          genFn()
        ];
        i += 3;
        assertAsyncScope();

        yield genFn;
        i++;
        assertAsyncScope();

        yield {key1: genFn, key2: genFn()};
        i += 2;
        assertAsyncScope();
        expect(genCalledTimes).to.equal(i);
      });
    });
  });
});
