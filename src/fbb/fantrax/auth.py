"""Authentication for the Fantrax Beta API."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class FantraxAuth(BaseSettings):
    """
    Fantrax API credentials.

    Loads FANTRAX_USER_SECRET_ID from environment variables or a .env file.
    Find your User Secret ID on the Fantrax User Profile page.
    """

    model_config = SettingsConfigDict(env_prefix='FANTRAX_', env_file='.env')

    user_secret_id: str

    def headers(self) -> dict[str, str]:
        """Return HTTP headers required to authenticate with the Beta API."""
        return {'User-Secret-Id': self.user_secret_id}
