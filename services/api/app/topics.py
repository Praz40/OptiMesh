"""MQTT topic layout: {prefix}/sites/{site_id}/devices/{device_id}/{channel}."""

from enum import StrEnum
from typing import NamedTuple
from uuid import UUID


class Channel(StrEnum):
    TELEMETRY = "telemetry"  # device -> platform
    COMMAND = "command"  # platform -> device
    ACK = "ack"  # device -> platform, answers a command


class DeviceTopic(NamedTuple):
    site_id: UUID
    device_id: UUID
    channel: Channel


def device_topic(prefix: str, site_id: UUID, device_id: UUID, channel: Channel) -> str:
    return f"{prefix}/sites/{site_id}/devices/{device_id}/{channel.value}"


def subscription(prefix: str, channel: Channel) -> str:
    return f"{prefix}/sites/+/devices/+/{channel.value}"


def parse_device_topic(prefix: str, topic: str) -> DeviceTopic | None:
    """Return the topic parts, or None for anything that is not a well-formed device topic."""
    if not topic.startswith(prefix + "/"):
        return None
    parts = topic[len(prefix) + 1 :].split("/")
    if len(parts) != 5 or parts[0] != "sites" or parts[2] != "devices":
        return None
    try:
        site_id, device_id = UUID(parts[1]), UUID(parts[3])
        if str(site_id) != parts[1] or str(device_id) != parts[3]:
            return None
        return DeviceTopic(site_id, device_id, Channel(parts[4]))
    except ValueError:
        return None
