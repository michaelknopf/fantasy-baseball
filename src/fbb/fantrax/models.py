"""Pydantic models for Fantrax API responses."""

from pydantic import BaseModel


class League(BaseModel):
    """A Fantrax league."""

    league_id: str
    name: str
    sport: str
