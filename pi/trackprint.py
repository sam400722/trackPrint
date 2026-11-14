#!/usr/bin/env python3
"""trackPrint sensor reader for a Raspberry Pi Zero 2 W.

Reads 4x MAX30102 (all fixed at 0x57), one per I2C bus, and streams raw IR as
CSV: `ir0,ir1,ir2,ir3` at 50 Hz. A missing sensor reads 0. This is the same
format the old Arduino sketch sent, so the web app doesn't change.

Usage: trackprint.py [OUT]   OUT defaults to /dev/ttyGS0 (USB gadget serial);
                             pass - to print to stdout for testing over ssh.
"""
import os
import sys
import termios
import threading
import time
import tty

from smbus2 import SMBus, i2c_msg

BUSES = [1, 3, 4, 5]  # sensor 0..3 -> /dev/i2c-N (see README wiring)
ADDR = 0x57
PERIOD = 0.02         # 50 Hz
RETRY = 2.0           # seconds between attempts to (re)open a missing sensor

# MAX30102 registers
FIFO_WR_PTR, OVF_COUNTER, FIFO_RD_PTR, FIFO_DATA = 0x04, 0x05, 0x06, 0x07
FIFO_CONFIG, MODE_CONFIG, SPO2_CONFIG = 0x08, 0x09, 0x0A
LED1_PA, LED2_PA, PART_ID = 0x0C, 0x0D, 0xFF

# Same settings as the old sketch's setup(0x1F, 4, 2, 200, 411, 4096).
# ponytail: LED power is the calibration knob; raise it if signal is weak, lower it if raw IR saturates near 262143
LED_POWER = 0x1F
FIFO_CFG = 0b010 << 5 | 1 << 4  # average 4 samples, FIFO rollover on
SPO2_CFG = 0b01 << 5 | 0b001 << 2 | 0b11  # 4096 nA range, 200 sps, 411 us pulse
MODE_SPO2 = 0x03  # red + IR


class Sensor:
    def __init__(self, bus_num):
        self.bus_num = bus_num
        self.bus = None
        self.ir = 0
        self.up = False
        self.next_try = 0.0

    def open(self):
        try:
            self.bus = SMBus(self.bus_num)
            b = self.bus
            if b.read_byte_data(ADDR, PART_ID) != 0x15:
                raise OSError('not a MAX30102')
            b.write_byte_data(ADDR, MODE_CONFIG, 0x40)  # reset
            deadline = time.monotonic() + 0.1
            while b.read_byte_data(ADDR, MODE_CONFIG) & 0x40:
                if time.monotonic() > deadline:
                    raise OSError('reset timed out')
                time.sleep(0.001)
            b.write_byte_data(ADDR, FIFO_CONFIG, FIFO_CFG)
            b.write_byte_data(ADDR, MODE_CONFIG, MODE_SPO2)
            b.write_byte_data(ADDR, SPO2_CONFIG, SPO2_CFG)
            b.write_byte_data(ADDR, LED1_PA, LED_POWER)
            b.write_byte_data(ADDR, LED2_PA, LED_POWER)
            for reg in (FIFO_WR_PTR, OVF_COUNTER, FIFO_RD_PTR):
                b.write_byte_data(ADDR, reg, 0)
            self.up = True
            log(f'sensor on i2c-{self.bus_num} ready')
        except OSError as e:
            self.drop(e)

    def drop(self, err):
        if self.up:  # only log transitions, not every retry of an absent sensor
            log(f'sensor on i2c-{self.bus_num} lost: {err}')
        if self.bus:
            self.bus.close()
        self.bus = None
        self.up = False
        self.ir = 0
        self.next_try = time.monotonic() + RETRY

    def poll(self):
        """Drain the FIFO, keep the newest IR sample."""
        if not self.bus:
            if time.monotonic() >= self.next_try:
                self.open()
            return
        try:
            b = self.bus
            wr = b.read_byte_data(ADDR, FIFO_WR_PTR)
            rd = b.read_byte_data(ADDR, FIFO_RD_PTR)
            n = (wr - rd) & 0x1F
            if not n:
                return
            msg = i2c_msg.read(ADDR, n * 6)  # each sample: red (3 bytes), IR (3 bytes)
            b.i2c_rdwr(i2c_msg.write(ADDR, [FIFO_DATA]), msg)
            d = bytes(msg)[-3:]
            self.ir = (d[0] << 16 | d[1] << 8 | d[2]) & 0x3FFFF
        except OSError as e:  # unplugged or bus glitch: retry later
            self.drop(e)

    def run(self):
        # One thread per sensor, so a slow or dead bus can't stall the 50 Hz output.
        while True:
            self.poll()
            time.sleep(PERIOD if self.bus else max(0.0, self.next_try - time.monotonic()))


def log(s):
    print(s, file=sys.stderr, flush=True)


class Out:
    """Line sink. Drops lines while nothing is listening instead of blocking."""

    def __init__(self, path):
        self.path = path
        self.fd = None

    def write(self, line):
        if self.path == '-':
            sys.stdout.write(line)
            sys.stdout.flush()
            return
        try:
            if self.fd is None:
                self.fd = os.open(self.path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
                tty.setraw(self.fd)  # no echo, no \n -> \r\n
                log(f'writing to {self.path}')
            os.write(self.fd, line.encode())
        except BlockingIOError:
            pass  # host isn't reading; drop this frame
        except (OSError, termios.error):
            if self.fd is not None:
                os.close(self.fd)
            self.fd = None  # gadget not up yet or unplugged; reopen next frame


def main():
    out = Out(sys.argv[1] if len(sys.argv) > 1 else '/dev/ttyGS0')
    sensors = [Sensor(n) for n in BUSES]
    for s in sensors:
        threading.Thread(target=s.run, daemon=True).start()
    nxt = time.monotonic()
    while True:
        out.write(','.join(str(s.ir) for s in sensors) + '\n')
        nxt += PERIOD
        delay = nxt - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        else:
            nxt = time.monotonic()  # fell behind; don't burst to catch up


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        pass
