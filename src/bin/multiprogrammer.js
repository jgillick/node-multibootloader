#!/usr/bin/env node

'use strict';

const SerialPort = require("serialport");
const MultiBootloader = require("../multibootloader");
const program = require('commander');

program
  .usage('[options] <file ...>')
  .description('Send a file to all devices on a serial bus.')
  .option('-l, --list',   'List all serial devices')
  .option('-b, --baud <number>',   'Baud rate to the serial device', parseInt)
  .option('-d, --device <name>', 'The serial device to connect to')
  .option('-s, --page-size <number>', 'The programming page size for your device.', parseInt)
  .option('-v, --version <maj.min>', 'The major.minor version of your program (for example 1.5)')
  .option('<file ...>',    'The file to program to your devices')
  .parse(process.argv);


function programDevices() {

  // Missing required options
  if (!program.baud || !program.device || !program.pageSize || program.args.length == 0) {
    program.outputHelp();
    return;
  }

  let version = null;
  if (program.version && program.version.indexOf('.') > 0) {
    const verParts = program.version.split('.');
    version = {
      major: parseInt(verParts[0], 10),
      minor: parseInt(verParts[1], 10),
    };
  }

  // Connect to port
  const port = new SerialPort(program.device, {
    baudRate: program.baud,
  }, (portErr) => {
    if (portErr) {
      console.error('Error:', err);
      return;
    }

    // Setup bootloader
    const bootloader = new MultiBootloader(port, {
      version,
      pageSize: program.pageSize,
    });

    bootloader.on('status', (status) => {
      console.log(`STATUS: ${status.message}`);
    });
    bootloader.on('error', (loaderErr) => {
      console.log(`ERROR: ${loaderErr.message}`);
    });

    // Program
    bootloader.program(program.args[0])
    .then(() => {
      console.log('Programming complete!');
    })
    .catch((err) => {
      console.log(`FATAL ERROR: ${err.message}`);
    });

  });
}

function main() {

  // List ports
  if (program.list) {
    SerialPort.list((err, ports) => {
      ports.forEach(port => console.log(port.comName));
    });
  }

  // Program
  else {
    programDevices();
  }
}

main();