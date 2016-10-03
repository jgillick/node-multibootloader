
import * as fs from 'fs';
import {EventEmitter} from 'events';
import {DiscoBusMaster} from 'discobus';

const MSG_START = 0xF1;
const MSG_PAGE_NUM = 0xF2;
const MSG_PAGE_DATA = 0xF3;
const MSG_END = 0xF4;

const MAX_RETRIES = 2;
const TIME_BETWEEN_PAGES = 800;
const SIGNAL_TIMEOUT = 1000

/**
 * Sends a program over a serial connection to one or more
 * devices on a multidrop bus.
 *
 * @class
 */
class MultiBootloader extends EventEmitter{

  /**
   * Create a new boot loader with an open connection to the bus.
   *
   * Option
   * ------
   *    - pageSize:         (required) The number of BYTES per page (not words)
   *                        Check the datasheet of the chip)
   *    - version.major:    The new program version's major number
   *    - version.minor:    The new program version's minor number
   *    - maxTries:         The maximum number of programming retries to make when there are errors.
   *    - timeBetweenPages: The number of milliseconds to pause between page messages.
   *    - signalTimeout:    Maximum time to wait for signal line to change to acknoledge nodes are ready.
   *
   * @param {SerialPort} serial An open SerialPort instance.
   * @param {Object} options List of programming options.
   */
  constructor(serial, options) {
    super();

    this._serial = serial;

    this._pages = [];
    this._currentPage = 0;
    this._programTries = 0;
    this._errorAtPage = -1;

    this._programPromise = {};

    if (typeof options.pageSize === 'undefined') {
      throw new Error('Page size was not set');
    }

    // Set default options
    this._opt = Object.assign({}, {
      maxTries: MAX_RETRIES,
      timeBetweenPages: TIME_BETWEEN_PAGES,
      signalTimeout: SIGNAL_TIMEOUT,
    }, options);
    this._opt.version = Object.assign({}, {
      major: 0,
      minor: 0,
    }, this._opt.version);

    // Init bus
    this._disco = new DiscoBusMaster();
    this._disco.connectWith(serial);

    // Normalize version numbers
    if (typeof this._opt.version !== 'undefined') {
      if (typeof this._opt.version.major === 'undefined') {
        this._opt.version.major = 0
      }
      if (typeof this._opt.version.minor === 'undefined') {
        this._opt.version.minor = 0
      }
    }
    else {
      this._opt.version.major = 0;
      this._opt.version.minor = 0;
    }
  }

  /**
   * Get the current page we're sending
   * @type {int}
   */
  get currentPage() {
    return this._currentPage;
  }

  /**
   * Get the total number of pages we're sending
   * @type {int}
   */
  get numPages() {
    return this._pages.length;
  }

  /**
   * Detects the signal line.
   * By defualt this looks at the DSR line on the serial connection,
   * but this method can be overriden to detect the state another way.
   *
   * When the line is HIGH, this will return `false`, when the line is LOW
   * it will return `true`. (the signal line is low enabled)
   *
   * @returns {Promise}
   */
  readSignalLine() {
    return new Promise((resolve, reject) => {
      this._serial.get((err, status) => {
        if (err) {
          this._emit('error', 'Could not read signal line');
          resolve(false);
        } else {
          resolve(!status.dsr);
        }
      });
    });
  }

  /**
   * Program all devices with this compiled program file.
   *
   * @param {String} filepath The path to the file to program
   *
   * @return {Promise}
   */
  program(filepath) {
    return new Promise((resolve, reject) => {
      this._programPromise = {
        resolve,
        reject,
      };

      // Read file
      fs.readFile(filepath, (err, content) => {
        if (err) {
          reject(err);
          return;
        }

        // Break up content by pages
        for (let i = 0; i < content.length; i += this._opt.pageSize) {
          const pageData = content.slice(i, i + this._opt.pageSize);
          this._pages.push(pageData);
        }

        this._emit('status', `Program file read. ${content.length} bytes, ${this._pages.length} pages.`);

        // Wait for signal line to be enabled, then start message
        this._untilSignal(true)
        .then(() => {
          this._sendStartMessage();
        })
        .catch(() => {
          this._programPromise.reject('Timed out waiting for devices to be ready. (i.e. signal line)');
        });
      });
    });
  }

  /**
   * Emit an event
   *
   * @param {String} type The type of even to emit.
   * @param {String} message The message to send out
   */
  _emit(type, message) {
    this.emit(type, {
      message,
      pages: this._pages.length,
      currentPage: this._currentPage,
      errorAtPage: this._errorAtPage,
      retries: this._programTries,
    });
  }

  /**
   * Send the start message and wait for signal line to become disabled
   */
  _sendStartMessage() {

    this._disco.startMessage(MSG_START, 2)
      .sendData([
        this._opt.version.major,
        this._opt.version.minor,
      ])
      .endMessage()
      .subscribe(
        // Error
        (err) => {
          this._programPromise.reject(`Error writing to serial device: ${err}`);
        },
        null,

        // Complete, now wait for the signal line to be disabled
        () => {
          this._untilSignal(false)
          .then(() => {
            this._sendPageNumber();
          })
          .catch(() => {
            this._programPromise.reject('Timed out waiting for devices to be ready. (i.e. signal line)');
          });
        }
      );
  }

  /**
   * Send the number of the upcoming page number
   */
  _sendPageNumber() {
    this._currentPage++;

    this._disco.startMessage(MSG_PAGE_NUM, 1)
      .sendData([this._currentPage])
      .endMessage()
      .subscribe(
        (err) => {
          this._programPromise.reject(`Error writing to serial device: ${err}`);
        },
        null,
        () => this._sendNextPage()
      );
  }

  /**
   * Write the next page of data to the devices
   */
  _sendNextPage() {
    const page = this._pages[this._currentPage - 1];

    this._emit('status', `Sending page ${this._currentPage}.`);

    // Send and pause before next page
    this._disco.startMessage(MSG_PAGE_DATA, page.length)
      .sendData(page)
      .endMessage()
      .subscribe(
        (err) => {
          this._programPromise.reject(`Error writing to serial device: ${err}`);
        },
        null,
        () => {
          onToTheNextPage.bind(this)();
        }
      );


    // Send the next page
    function onToTheNextPage() {

      // Check signal line for error (it not already raised)
      this.readSignalLine()
      .then((enabled) => {

        if (enabled === true && this._errorAtPage < 0) {
          this._errorAtPage = this._currentPage;
          this._emit('error', `A node reported an error verifying page ${this._errorAtPage}.`);
        }

        // Have we sent all pages
        if (this._currentPage >= this._pages.length) {

          // Retry
          if (this._errorAtPage > -1) {

            if (this._programTries < this._opt.maxTries) {
              this._programTries++;
              this._currentPage = this._errorAtPage;
              this._errorAtPage = -1;
              this._sendNextPage();
            }
            else {
              return this._programPromise.reject(`Programming retry limit reached.`);
            }
          }
          // Finish
          else {
            this._finish();
          }
        }
        // Send next page
        else {
          setTimeout(() => {
            this._sendPageNumber();
          }, this._opt.timeBetweenPages);
        }
      });
    }
  }

  /**
   * Finish up programming by sending the end message
   */
  _finish() {

    // Send twice, for good measure
    for (let i = 0; i < 2; i++) {
      let complete;

      this._disco.startMessage(MSG_END, 0)
        .endMessage()
        .subscribe(
          (err) => {
            this._programPromise.reject(`Error writing to serial device: ${err}`);
          },
          null,
          complete
        );

      complete = this._programPromise.resolve;
    }
  }

  /**
   * Wait until the signal line is the target value, and then
   * execute the callback function.
   *
   * If it takes more than `signalTimeout`, it will end in error.
   *
   * @param {boolean} target The target signal line value
   * @param {Function} callback
   */
  _untilSignal(target) {
    const delay = 100;
    let tries = 0;
    let time = 0;

    const checkSignal = (resolve, reject) => {
      time = tries * delay;
      tries++;

      this.readSignalLine()
      .then((enabled) => {
        if (enabled === target) {
          resolve();
        }
        else if (time < this._opt.signalTimeout) {
          setTimeout(() => {
            checkSignal(resolve, reject);
          }, delay);
        } else {
          reject('timed out')
        }
      })
      .catch((err) => {
        console.log('ERROR', err);
        reject(err);
      });
    };

    return new Promise((resolve, reject) => {
      checkSignal(resolve, reject);
    });

  }
}

module.exports = MultiBootloader;