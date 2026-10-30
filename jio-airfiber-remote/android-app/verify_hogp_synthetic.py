#!/usr/bin/env python3
"""Synthetic contract checks for the phone-side BLE HOGP HID implementation.

This is a source-level verifier: it parses the HID Report Descriptor embedded in
BluetoothHidRemote.kt and checks that the Kotlin GATT service wiring matches the
descriptor. It does not emulate a Jio STB, Android Bluetooth controller, or RF link.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from collections import defaultdict

SOURCE = Path(__file__).parent / "app/src/main/java/com/askmoina/airfiberremote/BluetoothHidRemote.kt"


def fail(message: str) -> None:
    raise AssertionError(message)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def extract_report_descriptor(source: str) -> list[int]:
    match = re.search(
        r"private\\s+val\\s+REPORT_DESCRIPTOR\\s*=\\s*byteArrayOf\\((.*?)\\n\\s*\\)",
        source,
        flags=re.S,
    )
    require(match is not None, "REPORT_DESCRIPTOR byteArrayOf block was not found")
    body = re.sub(r"//[^\\n]*", "", match.group(1))
    tokens = re.findall(r"0x[0-9A-Fa-f]+(?:\\.toByte\\(\\))?|(?<![\\w.])\\d+(?:\\.toByte\\(\\))?", body)
    values = []
    for token in tokens:
        number = int(token.split(".")[0], 16 if token.lower().startswith("0x") else 10)
        require(0 <= number <= 255, f"Descriptor byte out of range: {token}")
        values.append(number)
    require(values, "REPORT_DESCRIPTOR parsed as empty")
    return values


def parse_hid_descriptor(data: list[int]) -> tuple[dict[int, int], dict[int, tuple[int, int]], int]:
    """Return input bits/report ID, top-level app collection metadata, app count."""
    report_size = 0
    report_count = 0
    report_id = 0
    usage_page = None
    local_usage = None
    stack: list[dict[str, int | None]] = []
    report_bits: dict[int, int] = defaultdict(int)
    applications: dict[int, tuple[int, int]] = {}
    app_count = 0
    index = 0

    while index < len(data):
        prefix = data[index]
        index += 1
        if prefix == 0xFE:
            require(index + 2 <= len(data), "Truncated long HID item header")
            length = data[index]
            index += 2  # data length + long-item tag
            require(index + length <= len(data), "Truncated long HID item payload")
            index += length
            continue

        size_code = prefix & 0x03
        item_size = 4 if size_code == 3 else size_code
        item_type = (prefix >> 2) & 0x03
        item_tag = (prefix >> 4) & 0x0F
        require(index + item_size <= len(data), f"Truncated HID item at byte {index - 1}")
        raw = data[index:index + item_size]
        index += item_size
        value = int.from_bytes(bytes(raw), "little", signed=False) if raw else 0

        # Global items.
        if item_type == 1:
            if item_tag == 0:      # Usage Page
                usage_page = value
            elif item_tag == 7:    # Report Size
                report_size = value
            elif item_tag == 8:    # Report ID
                require(1 <= value <= 255, "HID Report ID must be 1..255")
                report_id = value
            elif item_tag == 9:    # Report Count
                report_count = value
        # Local items.
        elif item_type == 2 and item_tag == 0:  # Usage
            local_usage = value
        # Main items.
        elif item_type == 0:
            if item_tag == 10:  # Collection
                collection_type = value
                current = {"type": collection_type, "page": usage_page, "usage": local_usage}
                stack.append(current)
                if len(stack) == 1 and collection_type == 1:  # Application
                    app_count += 1
                    require(usage_page is not None and local_usage is not None,
                            "Top-level Application collection is missing Usage Page or Usage")
                    applications[report_id] = (usage_page, local_usage)
                local_usage = None
            elif item_tag == 12:  # End Collection
                require(bool(stack), "HID End Collection without matching Collection")
                stack.pop()
            elif item_tag == 8:  # Input
                require(report_size > 0 and report_count > 0, "HID Input has missing Report Size or Count")
                require(report_id in applications, f"Input report ID {report_id} is not inside a top-level Application collection")
                report_bits[report_id] += report_size * report_count
                local_usage = None
            elif item_tag in (9, 11):  # Output / Feature
                local_usage = None

    require(not stack, "HID descriptor has an unclosed Collection")
    require(report_bits, "HID descriptor declares no Input reports")
    return dict(report_bits), applications, app_count


def check_report_characteristic(source: str, object_name: str, report_id: str, report_bytes: str) -> None:
    require(
        re.search(
            rf"private\\s+val\\s+{object_name}\\s*=\\s*createInputReport\\({report_id},\\s*ByteArray\\({report_bytes}\\)\\)",
            source,
        ) is not None,
        f"{object_name} is not constructed with Report ID {report_id} and {report_bytes}-byte payload",
    )


def main() -> int:
    source = SOURCE.read_text(encoding="utf-8")

    # 1. Parse the real descriptor from the committed Kotlin source.
    descriptor = extract_report_descriptor(source)
    report_bits, applications, app_count = parse_hid_descriptor(descriptor)
    require(app_count == 2, f"Expected exactly 2 top-level HID Application collections; found {app_count}")
    require(report_bits.get(1) == 64, f"Keyboard Report ID 1 must be 64 bits; got {report_bits.get(1)}")
    require(report_bits.get(2) == 16, f"Consumer Control Report ID 2 must be 16 bits; got {report_bits.get(2)}")
    require(applications.get(1) == (0x01, 0x06),
            f"Report ID 1 must be Generic Desktop / Keyboard; got {applications.get(1)}")
    require(applications.get(2) == (0x0C, 0x01),
            f"Report ID 2 must be Consumer / Consumer Control; got {applications.get(2)}")
    print("PASS: HID Report Map parses; collections balance; keyboard=8 bytes, consumer=2 bytes")

    # 2. Verify that the GATT service exposes a separate instance for each Report ID.
    check_report_characteristic(source, "keyboardReport", "KEYBOARD_REPORT_ID", "8")
    check_report_characteristic(source, "consumerReport", "CONSUMER_REPORT_ID", "2")
    require("service.addCharacteristic(keyboardReport)" in source, "Keyboard Report characteristic is not added to HID service")
    require("service.addCharacteristic(consumerReport)" in source, "Consumer Report characteristic is not added to HID service")
    require("byteArrayOf(reportId, REPORT_TYPE_INPUT)" in source,
            "Report Reference descriptor must encode (Report ID, Input Report Type)")
    require("BluetoothGattDescriptor.PERMISSION_READ_ENCRYPTED" in source,
            "HID Report Reference must require an encrypted read")
    require(
        "BluetoothGattDescriptor.PERMISSION_READ_ENCRYPTED or BluetoothGattDescriptor.PERMISSION_WRITE_ENCRYPTED" in source,
        "HID Report CCCD must require encrypted read/write",
    )
    require(
        "BluetoothGattCharacteristic.PERMISSION_READ_ENCRYPTED" in source,
        "HID characteristics must require encrypted reads",
    )
    require(
        "BluetoothGattCharacteristic.PERMISSION_WRITE_ENCRYPTED" in source,
        "HID control / protocol characteristics must require encrypted writes",
    )
    print("PASS: HID GATT service exposes separate keyboard and consumer report instances with Report Reference + encrypted CCCD")

    # 3. Verify required HOGP support services and the GATT server response wiring.
    for uuid, label in (
        ("00001812-0000-1000-8000-00805f9b34fb", "HID service"),
        ("0000180A-0000-1000-8000-00805f9b34fb", "Device Information service"),
        ("0000180F-0000-1000-8000-00805f9b34fb", "Battery service"),
        ("00001813-0000-1000-8000-00805f9b34fb", "Scan Parameters service"),
    ):
        require(uuid.lower() in source.lower(), f"{label} UUID is missing")
    require("private const val REQUIRED_SERVICE_COUNT = 4" in source,
            "GATT setup is not waiting for all four services")
    require("server.addService(service)" in source and "addNextGattService()" in source,
            "GATT services are not registered via the sequential callback path")
    require("server.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS" in source,
            "GATT read/write requests are not acknowledged")
    require("BluetoothGattCharacteristic.PERMISSION_WRITE_ENCRYPTED" in source,
            "Scan Parameters write does not require encryption")
    print("PASS: HID, Device Information, Battery, and Scan Parameters services are wired and registered sequentially")

    # 4. Verify HOGP role and notification routing.
    require("Waiting for the TV (HID Host) to initiate secure pairing" in source,
            "Phone-side HOGP implementation is not waiting for the HID Host to initiate pairing")
    require(re.search(r"\\.createBond\\s*\\(", source) is None,
            "Phone-side createBond() call would race the HID Host's pairing procedure")
    require("registerBondReceiver(device)" in source,
            "Pairing state broadcasts are not monitored")
    require("Context.RECEIVER_EXPORTED" in source,
            "System Bluetooth bond-state broadcasts may not reach the receiver")
    require("sendInputReport(keyboardReport, keyboardSubscribers, report)" in source,
            "Keyboard notification is not routed to keyboard Report subscribers")
    require("sendInputReport(consumerReport, consumerSubscribers, report)" in source,
            "Consumer Control notification is not routed to Consumer Report subscribers")
    require("Last TV GATT operation:" in source,
            "Disconnect diagnostics do not report the last GATT operation")
    print("PASS: Host-initiated pairing, system bond monitoring, and per-report notification routing")

    print(f"SYNTHETIC HOGP CHECKS PASSED: {len(descriptor)} descriptor bytes; report IDs={sorted(report_bits)}")
    print("LIMIT: source/contract verification only; no Android controller, Jio STB, BLE radio, or over-the-air pairing was exercised.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except AssertionError as error:
        print(f"SYNTHETIC HOGP CHECK FAILED: {error}", file=sys.stderr)
        raise SystemExit(1)
