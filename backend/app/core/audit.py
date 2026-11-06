from sqlalchemy.orm import Session

from app.models.entities import AuditEvent


def audit(db: Session, actor: str, action: str, target: str | None = None, **details) -> None:
    db.add(AuditEvent(actor=actor, action=action, target=target, details=details or None))
    db.commit()
