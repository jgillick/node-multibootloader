'use strict';

const proxyquire = require('proxyquire');

require('source-map-support').install();

var fsStub = {
  readFile: function (path, callback) {

    // Return error
    if (path === 'badFile.hex') {
      callback('ERROR', null);
      return;
    }

    // Test program that is 35 characters long
    let testProgram = [];
    for (let i = 0; i < 35; i++) {
      testProgram.push(i);
    }
    callback(null, Buffer.from(testProgram));
  }
};

module.exports = proxyquire('../../dist/multibootloader', {
  fs: fsStub,
});
