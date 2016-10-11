# Node AVR Multi-Bootloader

[![Build Status](https://travis-ci.org/jgillick/node-multibootloader.svg?branch=master)](https://travis-ci.org/jgillick/node-multibootloader)

Program many devices at once over a multidrop bus, like RS485. This was written with AVR devices in mind, via the [AVR Multidrop Bootloader](https://github.com/jgillick/avr-multidrop-bootloader), but it can be usable for other devices that have
adapted that bootloader.

 * [CLI Interface](#cli-interface)
   * [Examples](#examples)
 * [API](#api)
   * [MultiBootloader(serial, options)](#multibootloaderserial-options)
   * [readSignalLine()](#readsignalline)
 * [Example using the API](#example-using-the-api)

## CLI Interface

```
  Usage: multiprogrammer [options] <file ...>

  Send a file to all devices on a serial bus.

  Options:

    -h, --help                output usage information
    -l, --list                List all serial devices
    -b, --baud <number>       Baud rate to the serial device
    -d, --device <name>       The serial device to connect to
    -s, --page-size <number>  The programming page size for your device.
    -v, --version <maj.min>   The major.minor version of your program (for example 1.5)
    -c, --command <number>    The Disco Bus message command that puts the devices into the bootloader.
    <file ...>                The file to program to your devices
```

### Examples

#### Basic Programming
```bash
multiprogrammer --baud 115200 --device /dev/cu.usbDevice0 -page-size 128
```
This is the most basic usage, which passes the device, baud speed and the device page size. 

**IMPORTANT** Page size will be different for all devices. Check your device's datasheet and look for "page size" and enter this value in _**bytes**_, not words. In the [Atmega328](http://www.atmel.com/Images/Atmel-42735-8-bit-AVR-Microcontroller-ATmega328-328P_datasheet.pdf) datasheet it's listed in section `31.5` as 64 words, which would be **128 bytes**.

#### Triggering Program Mode

You can pass a pre-command that will be sent as a disco bus message to trigger the device into programming mode.

```bash
multiprogrammer --baud 115200 --device /dev/cu.usbDevice0 -page-size 128 --command 0xF0
```

In this example, the programmer will first send the disco bus message `0xF0` to all devices. Then, normal programming
will continue after a 1 second delay.

The main program in these devices will need to watch for this message, and then swtich to the bootloader programming mode. 
You can see an example of a program that does this [here](https://github.com/jgillick/avr-multidrop-bootloader/tree/master/test_program).

## API

### MultiBootloader(serial, options)

The main constructor that creates a programmer instance.

_**Parameters**_
 * `serial`: An open [SerialPort](https://github.com/jgillick/node-serialport/)
 * `options`: Programmer options
   * `pageSize`: (required) The number of BYTES per page (not words)
   * `maxTries`: The maximum number of programming retries to make when there are errors.
   * `timeBetweenPages`: The number of milliseconds to pause between sending each page.
   * `signalTimeout`: Maximum time to wait for signal line to change to acknoledge nodes are ready.
   * `version.major`: The new program's version major number
   * `version.minor`: The new program's version minor number


### readSignalLine()

Detects the signal line, which is used to detect if there are errors in programming. 
By defualt this looks at the `DSR` line on the serial connection, but this method can be overriden to detect the state another way.

Currently the SerialPort library does not support reading the `DSR` value. Until that support is added, you can use [my fork](https://github.com/jgillick/node-serialport/) of their library.

### program(filepath)

Program all devices with this HEX program file. **NOTE**: This must be in Intel Hex format (generally the default hex format).

_**Parameters**_:
 * _filepath_: The path to the hex file to progrm the devices with.
 
## Example using the API

```js
var Multibootloader = require('../multibootloader');

// NOTE: this needs to use, this fork of the library to suppor the signal line reading: 
// https://github.com/jgillick/node-serialport/
var Serialport = require('serialport');

const PORT_NAME = '/dev/cu.usbDevice0'
const PORT_BAUD = 115200
const PAGE_SIZE = 128; // 64 words - atmega328

const programFile = './test_program.hex';

// Open serial port
const port = new SerialPort(PORT_NAME, 
  { baudRate: PORT_BAUD }, 
  (portErr) => {
    if (portErr) {
      console.error('Error:', portErr);
      return;
    }
    
    const bootloader = new MultiBootloader(port, {
      pageSize: PAGE_SIZE
    });
    
    // Listen to programming events
    bootloader.on('status', (status) => {
      console.log(status.message);
    });
    bootloader.on('error', (err) => {
      console.log(err.message);
    });
    
    // Program
    bootloader.program(config.args[0])
    .then(() => {
      console.log('Programming complete!');
    })
    .catch((err) => {
      console.error(`FATAL ERROR: ${err}`);
    });    
});


```
