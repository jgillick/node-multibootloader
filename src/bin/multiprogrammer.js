#!/usr/bin/env node

'use strict';

import { DiscoBusMaster } from 'discobus';
import SerialPort from 'serialport';
import config from 'commander';
import { terminal } from 'terminal-kit';
import MultiBootloader from '../multibootloader';

require('source-map-support').install();

config
  .usage('[options] <file ...>')
  .description('Send a file to all devices on a serial bus.')
  .option('-l, --list', 'List all serial devices')
  .option('-b, --baud <number>', 'Baud rate to the serial device', parseInt)
  .option('-d, --device <name>', 'The serial device to connect to')
  .option('-s, --page-size <number>', 'The programming page size for your device.', parseInt)
  .option('-v, --version <maj.min>', 'The major.minor version of your program (for example 1.5)')
  .option('-c, --command <number>', 'The Disco Bus message command that puts the devices into the bootloader.')
  .option('<file ...>', 'The file to program to your devices')
  .parse(process.argv);


function programDevices() {

  // Missing required options
  if (!config.baud || !config.device || !config.pageSize || config.args.length === 0) {
    config.outputHelp();
    process.exit();
  }

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

function runBootloader(port) {
  let linesAfterProgress = 0;
  console.log('Running bootloader');

  // Parse version
  let version = null;
  if (config.version && config.version.indexOf('.') > 0) {
    const verParts = config.version.split('.');
    version = {
      major: parseInt(verParts[0], 10),
      minor: parseInt(verParts[1], 10),
    };
  }

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
    signalTimeout: 3000,
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

function main() {

  // List ports
  if (config.list) {
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
