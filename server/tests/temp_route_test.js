const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../server');
const request = require('supertest'); // Oh wait, I didn't install supertest? I did actually: `npm i -D jest supertest` earlier, but maybe it didn't save? Oh wait, it did install supertest! Let's check.
