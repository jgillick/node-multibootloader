#!/usr/bin/env node

'use strict';

import { DiscoBusMaster } from 'discobus';
import SerialPort from 'serialport';
import config from 'commander';
import { terminal } from 'terminal-kit';
import MultiBootloader from '../lib';

require('source-map-support').install();

const DEFAULT_TIMEOUT = 5000;

/**
 * Run program
 */
function main() {
  parseArgs();

  // List ports
  if (config.list) {
    SerialPort.list((err, ports) => {
      ports.forEach(port => console.log(port.comName));
      process.exit();
    });
  }

  // Missing required options
  else if (!config.baud || !config.device || !config.pageSize || config.args.length === 0) {
    config.outputHelp();
    process.exit();
  }

  // Program
  else {
    programDevices();
  }
}


/**
 * Parse command line arguments
 */
function parseArgs() {
  const pkg = require('../../package.json');

  config
    .usage('[options] <file ...>')
    .description('Send a file to all devices on a serial bus.')
    .version(pkg.version)
    .option('-l, --list', 'List all serial devices')
    .option('-b, --baud <number>', 'Baud rate to the serial device', parseInt)
    .option('-c, --command <number>', 'The Disco Bus message command that puts the devices into the bootloader.')
    .option('-d, --device <name>', 'The serial device to connect to')
    .option('-s, --page-size <number>', 'The programming page size for your device.', parseInt)
    .option('-p, --prog-version <maj.min>', 'The major.minor version of your program (for example 1.5)')
    .option('-t, --timeout <number>', 'How long to wait for devices to be ready for programming')
    .option('<file ...>', 'The file to program to your devices')
    .parse(process.argv);
}


/**
 * Kick off the programmer
 */
function programDevices() {

  // Connect to port
  const port = new SerialPort(config.device, {
    baudRate: config.baud,
  }, (portErr) => {
    if (portErr) {
      console.error('Error:', portErr);
      process.exit();
    }

    if (!isNaN(config.command)) {
      sendBootloadCommand(port);
    }
    else {
      runBootloader(port);
    }
  });
}


/**
 * Send the single-byte command to the bus, which will put all the devices in their
 * bootloader programming mode.
 * @param  {SerialPort} port - The serial port to the bus
 */
function sendBootloadCommand(port) {
  const cmd = Number(config.command);
  const disco = new DiscoBusMaster();

  console.log(`Sending booloading command 0x${cmd.toString(16).toUpperCase()}`);

  disco.connectWith(port);
  disco.startMessage(cmd, 0)
    .endMessage()
    .subscribe(null, null,
      () => setTimeout(() => runBootloader(port), 1000)
    );
}


/**
 * Send the program to all the devices on the bus.
 * @param  {SerialPort} port - The serial port to the bus.
 */
function runBootloader(port) {
  let linesAfterProgress = 0;
  const timeout = Number(config.timeout || DEFAULT_TIMEOUT);
  const version = parseProgVersion();
  console.log('Running bootloader');

  // Progress bar
  terminal.previousLine(1);
  terminal.eraseLine();
  const progress = terminal.progressBar({
    title: 'Sending',
    percent: true,
  });
  terminal.nextLine(2);
  linesAfterProgress = 1;

  // Setup bootloader
  const bootloader = new MultiBootloader(port, {
    version,
    pageSize: config.pageSize,
    signalTimeout: timeout,
  });

  // Events
  bootloader.on('status', (status) => {
    let percentDone = 0;
    if (status.currentPage > 0 && status.pages > 0) {
      percentDone = status.currentPage / status.pages;
    }

    const sendTitle = (status.retries === 0) ? 'Sending' : 'Resending';
    progress.update({
      progress: percentDone,
      title: sendTitle,
    });

    terminal.saveCursor();
    terminal.previousLine(linesAfterProgress - 1);
    terminal.eraseLine();
    console.log(status.message);
    terminal.restoreCursor();
  });
  bootloader.on('error', (loaderErr) => {
    linesAfterProgress++;
    console.log(`ERROR: ${loaderErr.message}`);
  });

  // Program
  bootloader.program(config.args[0])
  .then(() => {
    progress.update(1);

    console.log('Programming complete!');
    port.close((err) => {
      if (err) console.log('Error closeing connection', err);
      process.exit();
    });
  })
  .catch((err) => {
    console.log(`FATAL ERROR: ${err}`);
    process.exit();
  });
}


/**
 * Parse the program version passed in via the command line, and
 * either return an object with `major` and `minor` numbers, or null.
 *
 * @returns {Object} An object with `major` and `minor` version parsed.
 */
function parseProgVersion() {
  if (config.progVersion && config.progVersion.indexOf('.') > 0) {
    const verParts = config.progVersion.split('.');
    return {
      major: parseInt(verParts[0], 10),
      minor: parseInt(verParts[1], 10),
    };
  }
  return null;
}

main();
