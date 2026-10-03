"""Verified bearer identities for registry routes; site authorization lives in the registry."""

from dataclasses import dataclass
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWK, PyJWKClient, PyJWKClientConnectionError, PyJWTError

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True, slots=True)
class Principal:
    user_id: UUID


def authentication_error() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail="Invalid or missing authentication",
        headers={"WWW-Authenticate": "Bearer"},
    )


class ProjectSigningKeys(PyJWKClient):
    """Provider failures are service errors; an unknown token key remains a credential error."""

    def get_signing_keys(self, refresh: bool = False) -> list[PyJWK]:
        try:
            return super().get_signing_keys(refresh=refresh)
        except (PyJWTError, ValueError, TypeError):
            raise HTTPException(status_code=503, detail="Authentication unavailable") from None


class JwtVerifier:
    def __init__(self, project_url: str) -> None:
        self.issuer = project_url.rstrip("/") + "/auth/v1"
        self.keys = ProjectSigningKeys(
            self.issuer + "/.well-known/jwks.json", timeout=3, lifespan=300, cache_keys=False
        )

    def verify(self, token: str) -> Principal:
        if len(token) > 8192:
            raise authentication_error()
        try:
            header = jwt.get_unverified_header(token)
            algorithm = header.get("alg")
            if algorithm not in ("ES256", "RS256") or not isinstance(header.get("kid"), str):
                raise authentication_error()
            key = self.keys.get_signing_key(header["kid"])
            if key.algorithm_name != algorithm:
                raise authentication_error()
            claims = jwt.decode(
                token,
                key.key,
                algorithms=[algorithm],
                issuer=self.issuer,
                audience="authenticated",
                options={"require": ["iss", "aud", "exp", "sub"]},
            )
            if claims.get("role") != "authenticated":
                raise authentication_error()
            return Principal(user_id=UUID(claims["sub"]))
        except PyJWKClientConnectionError:
            raise HTTPException(status_code=503, detail="Authentication unavailable") from None
        except (PyJWTError, ValueError, TypeError):
            raise authentication_error() from None


def get_current_principal(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> Principal:
    if credentials is None:
        raise authentication_error()
    verifier: JwtVerifier | None = request.app.state.token_verifier
    if verifier is None:
        raise HTTPException(status_code=503, detail="Authentication unavailable")
    return verifier.verify(credentials.credentials)


PrincipalDep = Annotated[Principal, Depends(get_current_principal)]
