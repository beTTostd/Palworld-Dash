#!/usr/bin/env python3
"""Extract a privacy-safe, read-only player profile projection from Palworld saves."""

from __future__ import annotations

import json
import os
import re
import shutil
import sqlite3
import tempfile
import time
from pathlib import Path
from typing import Any

from palsav.core import decompress_sav_to_gvas
from palsav.gvas import GvasFile
from palsav.paltypes import PALWORLD_CUSTOM_PROPERTIES, PALWORLD_TYPE_HINTS


SAVE_ROOT = Path(os.environ.get("PALWORLD_SAVE_ROOT", "/palworld-save"))
DATABASE_PATH = Path(os.environ.get("PALWORLD_DATABASE_PATH", "/data/palworld.db"))
OUTPUT_PATH = Path(os.environ.get("PALWORLD_PROFILE_PATH", "/data/player_profiles.json"))
CHARACTER_CATALOG_PATH = Path(os.environ.get(
    "PALWORLD_CHARACTER_CATALOG",
    "/opt/palworld-save-parser/source/resources/game_data/characters.json",
))
ZERO_GUID = "00000000-0000-0000-0000-000000000000"

PAL_NAMES = {
    "FlyingManta": "Celaray",
    "Mutant": "Lunaris",
    "NaughtyCat": "Grintale",
    "SamuraiDog": "Pupperai",
    "ThunderBird": "Beakon",
}

try:
    character_catalog = json.loads(CHARACTER_CATALOG_PATH.read_text(encoding="utf-8"))
    PAL_NAMES.update({pal["asset"]: pal["name"] for pal in character_catalog.get("pals", [])})
except (OSError, ValueError, TypeError, KeyError):
    pass

STATUS_NAMES = {
    "最大HP": "Vida",
    "最大SP": "Stamina",
    "攻撃力": "Ataque",
    "所持重量": "Peso",
    "捕獲率": "Captura",
    "作業速度": "Trabalho",
    "移動速度アップ": "Movimento",
    "空腹率低減": "Redução de fome",
    "パルスフィアホーミング": "Homing de esfera",
    "経験値ボーナス": "Bônus de XP",
    "食料腐敗低減": "Conservação de comida",
    "ジャンプ力": "Salto",
    "滑空速度": "Planagem",
    "泳ぎ速度": "Natação",
    "崖登り速度": "Escalada",
    "状態異常耐性": "Resistência a status",
    "虹パッシブ率": "Chance de passiva arco-íris",
}


def unwrap(value: Any, default: Any = None) -> Any:
    if not isinstance(value, dict):
        return default
    return value.get("value", default)


def nested(value: Any, *path: str, default: Any = None) -> Any:
    current = value
    for key in path:
        if not isinstance(current, dict) or key not in current:
            return default
        current = current[key]
    return current


def load_sav(path: Path) -> dict[str, Any]:
    raw_gvas, _ = decompress_sav_to_gvas(path.read_bytes())
    return GvasFile.read(
        raw_gvas,
        PALWORLD_TYPE_HINTS,
        PALWORLD_CUSTOM_PROPERTIES,
    ).properties


def humanize(identifier: str) -> str:
    text = identifier.removeprefix("BOSS_")
    text = re.sub(r"[_-]+", " ", text)
    text = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", text)
    text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", text)
    return text.strip() or "Desconhecido"


def pal_name(character_id: str, nickname: str | None) -> str:
    if nickname:
        return nickname
    plain_id = character_id.removeprefix("BOSS_")
    return PAL_NAMES.get(plain_id, humanize(plain_id))


def player_keys_by_name() -> dict[str, str]:
    with sqlite3.connect(f"file:{DATABASE_PATH}?mode=ro&immutable=1", uri=True) as connection:
        rows = connection.execute("SELECT player_key,name FROM players").fetchall()
    counts: dict[str, int] = {}
    for _, name in rows:
        counts[name] = counts.get(name, 0) + 1
    return {name: key for key, name in rows if counts[name] == 1}


def newest_level_save() -> Path:
    backups = list(SAVE_ROOT.glob("backup/world/*/Level.sav"))
    return max(backups, key=lambda path: path.stat().st_mtime) if backups else SAVE_ROOT / "Level.sav"


def copy_snapshot(destination: Path) -> tuple[Path, Path, int]:
    level_source = newest_level_save()
    level_target = destination / "Level.sav"
    players_target = destination / "Players"
    shutil.copy2(level_source, level_target)
    shutil.copytree(SAVE_ROOT / "Players", players_target)
    return level_target, players_target, int(level_source.stat().st_mtime)


def extract_status_points(parameters: dict[str, Any]) -> list[dict[str, Any]]:
    values = nested(parameters, "GotStatusPointList", "value", "values", default=[])
    return [
        {
            "name": STATUS_NAMES.get(unwrap(row.get("StatusName"), ""), humanize(unwrap(row.get("StatusName"), ""))),
            "points": int(unwrap(row.get("StatusPoint"), 0)),
        }
        for row in values
        if int(unwrap(row.get("StatusPoint"), 0)) > 0
    ]


def extract_pal(parameters: dict[str, Any]) -> dict[str, Any]:
    character_id = str(unwrap(parameters.get("CharacterID"), "Unknown"))
    gender = nested(parameters, "Gender", "value", "value", default="Unknown").split("::")[-1]
    return {
        "name": pal_name(character_id, unwrap(parameters.get("NickName"))),
        "speciesId": character_id.removeprefix("BOSS_"),
        "level": int(nested(parameters, "Level", "value", "value", default=1)),
        "gender": "Macho" if gender == "Male" else "Fêmea" if gender == "Female" else "—",
        "rank": int(nested(parameters, "Rank", "value", "value", default=1)),
        "lucky": bool(unwrap(parameters.get("IsRarePal"), False)),
        "alpha": character_id.startswith("BOSS_"),
        "favorite": parameters.get("FavoriteIndex") is not None,
        "hp": round(nested(parameters, "Hp", "value", "Value", "value", default=0) / 1000),
        "passives": list(nested(parameters, "PassiveSkillList", "value", "values", default=[])),
        "skills": [str(skill).split("::")[-1] for skill in nested(parameters, "EquipWaza", "value", "values", default=[])],
    }


def extract_equipment(world: dict[str, Any], container_ids: dict[str, str]) -> list[dict[str, Any]]:
    containers = {
        nested(entry, "key", "ID", "value"): entry
        for entry in nested(world, "ItemContainerSaveData", "value", default=[])
    }
    dynamic_items = {}
    for entry in nested(world, "DynamicItemSaveData", "value", "values", default=[]):
        raw = nested(entry, "RawData", "value", default={})
        dynamic_id = nested(raw, "id", "local_id_in_created_world")
        if dynamic_id:
            dynamic_items[dynamic_id] = raw

    result = []
    for category, container_id in container_ids.items():
        container = containers.get(container_id)
        for slot in nested(container, "value", "Slots", "value", "values", default=[]):
            raw = nested(slot, "RawData", "value", default={})
            item = raw.get("item") or {}
            static_id = str(item.get("static_id") or "")
            if not static_id or static_id == "None":
                continue
            dynamic_id = nested(item, "dynamic_id", "local_id_in_created_world")
            dynamic = dynamic_items.get(dynamic_id, {})
            result.append({
                "category": category,
                "slot": int(raw.get("slot_index") or 0),
                "name": humanize(static_id),
                "itemId": static_id,
                "durability": round(float(dynamic.get("durability") or 0)),
                "remainingBullets": int(dynamic.get("remaining_bullets") or 0),
            })
    return sorted(result, key=lambda item: (item["category"], item["slot"]))


def extract_profiles() -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="palworld-profile-") as temporary:
        snapshot = Path(temporary)
        level_path, players_path, save_timestamp = copy_snapshot(snapshot)
        properties = load_sav(level_path)
        world = nested(properties, "worldSaveData", "value", default={})
        character_entries = nested(world, "CharacterSaveParameterMap", "value", default=[])

        characters: dict[str, dict[str, Any]] = {}
        player_characters: dict[str, dict[str, Any]] = {}
        for entry in character_entries:
            instance_id = nested(entry, "key", "InstanceId", "value")
            player_uid = nested(entry, "key", "PlayerUId", "value")
            parameters = nested(entry, "value", "RawData", "value", "object", "SaveParameter", "value")
            if not instance_id or not isinstance(parameters, dict):
                continue
            characters[instance_id] = parameters
            if player_uid and player_uid != ZERO_GUID and unwrap(parameters.get("IsPlayer"), False):
                player_characters[player_uid] = parameters

        key_by_name = player_keys_by_name()
        profiles: dict[str, Any] = {}
        for player_path in players_path.glob("*.sav"):
            player_save = nested(load_sav(player_path), "SaveData", "value", default={})
            player_uid = unwrap(player_save.get("PlayerUId"))
            player_parameters = player_characters.get(player_uid)
            if not player_parameters:
                continue
            player_name = str(unwrap(player_parameters.get("NickName"), ""))
            player_key = key_by_name.get(player_name)
            if not player_key:
                continue

            party_id = nested(player_save, "OtomoCharacterContainerId", "value", "ID", "value")
            storage_id = nested(player_save, "PalStorageContainerId", "value", "ID", "value")
            owned: list[tuple[str, dict[str, Any]]] = []
            for instance_id, parameters in characters.items():
                if unwrap(parameters.get("OwnerPlayerUId")) == player_uid:
                    owned.append((instance_id, parameters))

            team = []
            storage_count = 0
            other_count = 0
            for _, parameters in owned:
                container_id = nested(parameters, "SlotId", "value", "ContainerId", "value", "ID", "value")
                if container_id == party_id:
                    team.append((int(nested(parameters, "SlotId", "value", "SlotIndex", "value", default=0)), extract_pal(parameters)))
                elif container_id == storage_id:
                    storage_count += 1
                else:
                    other_count += 1

            inventory = nested(player_save, "InventoryInfo", "value", default={})
            equipment_ids = {
                "Armas": nested(inventory, "WeaponLoadOutContainerId", "value", "ID", "value"),
                "Equipamentos": nested(inventory, "PlayerEquipArmorContainerId", "value", "ID", "value"),
            }
            species = {str(unwrap(parameters.get("CharacterID"), "")).removeprefix("BOSS_") for _, parameters in owned}
            profiles[player_key] = {
                "parsedAt": int(time.time()),
                "saveTimestamp": save_timestamp,
                "attributes": {
                    "hp": round(nested(player_parameters, "Hp", "value", "Value", "value", default=0) / 1000),
                    "shield": round(nested(player_parameters, "ShieldHP", "value", "Value", "value", default=0) / 1000),
                    "technologyPoints": int(unwrap(player_save.get("TechnologyPoint"), 0)),
                    "ancientTechnologyPoints": int(unwrap(player_save.get("bossTechnologyPoint"), 0)),
                    "unusedStatusPoints": int(unwrap(player_parameters.get("UnusedStatusPoint"), 0)),
                    "allocations": extract_status_points(player_parameters),
                },
                "collection": {
                    "total": len(owned),
                    "uniqueSpecies": len(species),
                    "team": len(team),
                    "palbox": storage_count,
                    "basesOrOther": other_count,
                    "alpha": sum(str(unwrap(parameters.get("CharacterID"), "")).startswith("BOSS_") for _, parameters in owned),
                    "lucky": sum(bool(unwrap(parameters.get("IsRarePal"), False)) for _, parameters in owned),
                },
                "team": [pal for _, pal in sorted(team, key=lambda item: item[0])],
                "equipment": extract_equipment(world, equipment_ids),
            }

    return {"version": 1, "generatedAt": int(time.time()), "profiles": profiles}


def main() -> None:
    payload = extract_profiles()
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=OUTPUT_PATH.parent, delete=False) as output:
        json.dump(payload, output, ensure_ascii=False, separators=(",", ":"))
        temporary_path = Path(output.name)
    temporary_path.chmod(0o644)
    os.replace(temporary_path, OUTPUT_PATH)
    print(json.dumps({"ok": True, "profiles": len(payload["profiles"]), "output": str(OUTPUT_PATH)}))


if __name__ == "__main__":
    main()
