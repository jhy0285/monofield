from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class FieldSpec:
    section: str
    name_en: str
    name_ko: str
    data_type: str
    required: str = "N"
    note: str = ""
    # Hierarchy metadata for nested DTO expansion.
    path: str | None = None
    parent_path: str | None = None
    depth: int = 0


@dataclass
class ApiEndpoint:
    method: str
    path: str
    api_key: str
    controller_file: str
    controller_line: int
    method_name: str
    package_name: str = ""
    service_name: str = ""
    request_body_type: Optional[str] = None
    query_dto_type: Optional[str] = None
    response_type: Optional[str] = None
    auth_required: bool = False
    interface_id: Optional[str] = None
    interface_name: Optional[str] = None
    request_fields: list[FieldSpec] = field(default_factory=list)
    response_fields: list[FieldSpec] = field(default_factory=list)


@dataclass
class RunSummary:
    total_api_count: int = 0
    success_api_count: int = 0
    failure_api_count: int = 0
    generated_sheet_count: int = 0
    excluded_api_count: int = 0
    field_added_count: int = 0
    field_updated_count: int = 0
    field_deleted_count: int = 0
    renumber_fix_count: int = 0
    validation_pass_count: int = 0
    validation_fail_count: int = 0
    manual_check_count: int = 0
    fatal_error_count: int = 0


@dataclass
class BuildContext:
    run_id: str
    repo_root: Path
    temp_interface_path: Path
    fatal_errors: list[str] = field(default_factory=list)
