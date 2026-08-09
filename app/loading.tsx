export default function Loading() {
  return (
    <div className="boot-splash" role="status" aria-label="Загрузка">
      <div className="boot-splash-inner">
        <div className="boot-splash-word">KNOPIK</div>
        <div className="boot-splash-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      </div>
    </div>
  );
}
