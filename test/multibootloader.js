/*eslint prefer-arrow-callback: "off"*/

'use strict';

const sinon = require('sinon');
const chai = require('chai');
const expect = require('chai').expect;
const sinonChai = require("sinon-chai");

chai.use(sinonChai);

const MultiBootloader = require("./mocks/multibootloader.mock");
const SerialPort = require('./mocks/serialport.mock');

const MSG_START = 0xF1;
const MSG_PAGE_NUM = 0xF2;
const MSG_PAGE_DATA = 0xF3;
const MSG_END = 0xF4;

/**
 * General object construction
 */
describe('MultiBootloader Constructor', function () {
  let serial;

  beforeEach(function () {
    serial = new SerialPort();
  });

  it('should throw an exception with no page size', function () {
    expect(() => { new MultiBootloader(serial); }).to.throw(Error);
  });

  it('should default version number when none is set', function () {
    const bootloader = new MultiBootloader(serial, {
      pageSize: 10,
    });
    expect(bootloader._opt.version.major).to.equal(0);
    expect(bootloader._opt.version.minor).to.equal(0);
  });

  it('should default minor version number', function () {
    const bootloader = new MultiBootloader(serial, {
      pageSize: 10,
      version: {
        major: 1,
      },
    });
    expect(bootloader._opt.version.major).to.equal(1);
    expect(bootloader._opt.version.minor).to.equal(0);
  });

  it('should default major version number', function () {
    const bootloader = new MultiBootloader(serial, {
      pageSize: 10,
      version: {
        minor: 1,
      },
    });
    expect(bootloader._opt.version.major).to.equal(0);
    expect(bootloader._opt.version.minor).to.equal(1);
  });
});

/**
 * General object construction
 */
describe('Programming', function () {
  let signal;
  let serial;
  let statusSpy;
  let errorSpy;
  let lastStatus;
  let lastError;
  let bootloader;

  // Automatically disable the signal line, when the start message has been sent
  function autoSignal() {
    signal = true;

    serial.on('write', (data) => {
      const cmd = data[2];
        if (cmd === MSG_START) {
        signal = false;
      }
    });
  }

  // Wrap the endMessage method with something custom
  function wrapEndMessage(func) {
    let origMethod = bootloader._disco.endMessage;

    bootloader._disco.endMessage = function() {
      let ret = bootloader._disco;
      try {
        ret = origMethod.apply(bootloader._disco, arguments);
        func.apply(bootloader._disco, arguments);
      } catch(e) { }
      return ret;
    };
  }

  beforeEach(function () {
    signal = false;
    serial = new SerialPort();

    bootloader = new MultiBootloader(serial, {
      pageSize: 10,
      maxTries: 2,
      timeBetweenPages: 10,
    });

    // Event spies
    statusSpy = sinon.spy(function (status) {
      lastStatus = status;
    });
    errorSpy = sinon.spy(function (err) {
      lastError = err;
    });
    bootloader.on('status', statusSpy);
    bootloader.on('error', errorSpy);

    // Override serial function for signal state
    serial.get = function (cb) {
      cb(null, { dsr: signal });
    };
  });

  it('should send status when file has been read', function () {
    bootloader.program('goodFile.hex');

    expect(statusSpy).to.have.been.called;
    expect(lastStatus.pages).to.be.equal(4); // 35 bytes, at 10 bytes per page = 4 pages (~3.5)
  });

  it('should throw file error', function (done) {
    bootloader.program('badFile.hex')
    .catch(() => { done(); });
  });

  it('should start message when signal is enabled', function (done) {
    bootloader._sendStartMessage = function () {
      const err = (signal !== true) ? 'Started before signal' : false;
      done(err);
    };

    bootloader.program('goodFile.hex');

    // Enable signal after 1 second
    setTimeout(() => { signal = true; }, 1000);
  });

  it('should start sending pages when signal is disabled', function (done) {
    signal = true;

    bootloader._sendPageNumber = () => {
      try {
        expect(signal).to.be.equal(false);
        done();
      } catch (e) { done(e); }
    };

    bootloader.program('goodFile.hex');

    // Disable signal after 1 second
    setTimeout(() => { signal = false; }, 1000);
  });

  it('should end with a promise', function (done) {
    signal = true;

    autoSignal();
    bootloader.program('goodFile.hex')
    .then(done);
  });

  it('should send page number, pages and end message', function (done) {
    let nextPage = -1;
    let finished = false;

    signal = true;
    serial.buffer = [];
    autoSignal();
    bootloader.program('goodFile.hex');

    // Ensure that page numbers and data line up
    wrapEndMessage(function () {
      try {
        const cmd = this._msgCommand;
        const data = serial.buffer.slice(7, -2);

        if (cmd === MSG_PAGE_NUM) {
          nextPage = data[0];
        }
        else if (cmd === MSG_PAGE_DATA) {
          const dataStart = nextPage * bootloader._opt.pageSize;
          expect(data[0]).to.be.equal(dataStart);
        }
        else if (cmd === MSG_END && !finished) {
          done();
          finished = true;
        }

      } catch (e) { done(e); }
      serial.buffer = [];
    });
  });

  it('should retry on error', function (done) {
    let tries = 1;
    let finished = false;

    autoSignal();
    bootloader.program('goodFile.hex');

    // Raise failed verification signal on page 2
    wrapEndMessage(function () {
      try {
        const cmd = this._msgCommand;

        if (cmd === MSG_PAGE_DATA && bootloader.currentPage === 2) {
          if (tries === 0) {
            signal = true;
          } else {
            signal = false;
          }
          tries++;
        }
        else if (cmd === MSG_END && !finished) {
          expect(tries).to.be.equal(2);
          done();
          finished = true;
        }
      } catch (e) { done(e); }
    });
  });

  it('should error on max retries', function (done) {
    autoSignal();

    bootloader.program('goodFile.hex')
    .then(() => {
      done('Did not time out.');
    })
    .catch(() => {
      try {
        expect(bootloader._programTries).to.be.equal(bootloader._opt.maxTries);
        done();
      } catch (e) { done(e); }
    });

    // Raise failed verification signal
    wrapEndMessage(function () {
      if (this._msgCommand === MSG_PAGE_DATA) {
        signal = true;
      }
    });
  });


});
