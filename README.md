# trackPrint

Four heart-rate sensors → four-voice electronic band in the browser.
ch0 drums · ch1 bass · ch2 lead · ch3 pad.

## How it fits together
```
4x MAX30102 ──(4 separate I2C buses)──► Raspberry Pi Zero 2 W ──(USB serial)──► laptop browser
```
Every MAX30102 has the same fixed I2C address (0x57), so two of them can't share a bus. We don't use a multiplexer. Instead, each sensor gets its own I2C bus on the Pi: one hardware bus plus three software (`i2c-gpio`) buses.

The Pi runs in USB gadget mode, so the laptop sees it as a serial port. It sends the same `ir0,ir1,ir2,ir3` lines at 50 Hz that the web app already reads, so nothing changes on the browser side.

## Parts
- Raspberry Pi Zero 2 W with a microSD card running Raspberry Pi OS Lite
- 4x MAX30102 breakout
- A micro-USB **data** cable (not a charge-only cable)

## Wiring
Pin numbers are physical header pins. Every sensor's VIN goes to 3.3V and every GND goes to GND. Use pins 1/17 for 3.3V and any of 6, 9, 14, 20, 25, 30, 34, 39 for GND.

| Sensor | Pi bus | SDA | SCL |
|---|---|---|---|
| 0 | `/dev/i2c-1` (hardware) | pin 3 (GPIO2) | pin 5 (GPIO3) |
| 1 | `/dev/i2c-3` (i2c-gpio) | pin 11 (GPIO17) | pin 13 (GPIO27) |
| 2 | `/dev/i2c-4` (i2c-gpio) | pin 15 (GPIO22) | pin 16 (GPIO23) |
| 3 | `/dev/i2c-5` (i2c-gpio) | pin 18 (GPIO24) | pin 22 (GPIO25) |

Only 3.3V belongs on these pins. Never put 5V on a Pi GPIO pin. The breakouts' own SDA/SCL resistors are the real pull-ups. The Pi's weak internal ones (see setup) only keep an empty bus from hanging. Some cheap purple MAX30102 boards pull up to 1.8V, and those need the pull-up jumper or trace moved to 3.3V. If a sensor reads `0`, check its wiring and pull-up voltage.

## Pi setup
Flash Raspberry Pi OS Lite (Trixie), enable SSH, then from this repo:
```bash
ssh flatline@flatline.local 'mkdir -p trackprint'
scp pi/* flatline@flatline.local:trackprint/
ssh flatline@flatline.local 'cd trackprint && sudo ./setup.sh && sudo reboot'
```
`pi/setup.sh` is safe to re-run. It:
- installs `python3-smbus2` and `i2c-tools`
- appends the I2C buses, internal pull-ups and USB gadget mode to `/boot/firmware/config.txt`:
  ```ini
  dtparam=i2c_arm=on
  dtoverlay=i2c-gpio,bus=3,i2c_gpio_sda=17,i2c_gpio_scl=27
  dtoverlay=i2c-gpio,bus=4,i2c_gpio_sda=22,i2c_gpio_scl=23
  dtoverlay=i2c-gpio,bus=5,i2c_gpio_sda=24,i2c_gpio_scl=25
  dtoverlay=dwc2,dr_mode=peripheral
  gpio=17,22-25,27=pu
  ```
  The `gpio=...=pu` line matters: without pull-ups, an empty software bus hangs on timeouts instead of failing fast.
- adds `modules-load=dwc2,g_serial` to `/boot/firmware/cmdline.txt`
- installs the reader to `/opt/trackprint/trackprint.py` and enables `trackprint.service`, which starts it at boot

To update the reader later, copy `pi/` over again and re-run `setup.sh`, then run `sudo systemctl restart trackprint`.

## Sensor reader
`pi/trackprint.py` sets up each MAX30102 the same way the old Arduino sketch did: LED power 0x1F, 4-sample average, red+IR, 200 sps, which works out to 50 Hz out. It writes one `ir0,ir1,ir2,ir3` line every 20 ms to `/dev/ttyGS0`, with `0` for a missing sensor. Each sensor is read in its own thread, so an unplugged sensor drops to `0` and is picked up again within about 2 s of being plugged back in.

Checks, over ssh:
```bash
i2cdetect -y 1        # also -y 3, -y 4, -y 5; each should show 57
journalctl -u trackprint -f                                     # "sensor on i2c-N ready" / "lost"
sudo systemctl stop trackprint && python3 /opt/trackprint/trackprint.py -   # print lines to the terminal
sudo systemctl start trackprint
```
A value jumps above ~50000 with a finger on.

Connect the Pi's **USB** port (not PWR IN) to the laptop. That one cable powers the Pi and carries the data. The Pi takes about 30 s to boot, and then it shows up as a serial port (`/dev/cu.usbmodem*` on a Mac). Shut it down with `sudo poweroff` before unplugging, so the SD card doesn't get corrupted.

`firmware/trackprint/` is the old Arduino + TCA9548A sketch, kept for reference.

## Run
```bash
cd web && python3 -m http.server 8000
```
Open http://localhost:8000 in Chrome or Edge. Use **Simulate** (no hardware) or **Connect sensors**, and pick the Pi's serial port.

## Test
```bash
node web/test.mjs
```
