'use strict';

const sinon = require('sinon');
const EventEmitter = require('events');

// Stub out SerialPort module
class SerialPortMock extends EventEmitter {
  constructor(dev, options) {
    super();
    this.dev = dev;
    this.options = options;
    this.buffer = [];

    sinon.spy(this, 'write');
    sinon.spy(this, 'on');

    this.emit('open');
  }

  write(data) {
    this.buffer.push.apply(this.buffer, data);
    this.emit('write', data);
  }
  drain(cb) {
    cb();
  }

  // Send data that shoudl appear to be received from a slave node
  receiveData(data) {
    this.emit('data', data);
  }
}
SerialPortMock.prototype.set = function (config, cb) {
  cb();
};

module.exports = SerialPortMock;