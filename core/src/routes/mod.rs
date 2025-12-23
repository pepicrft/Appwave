use crate::server::AppState;
use axum::{
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::get,
    Router,
};
use serde_json::json;
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};

/// Create all routes for the application
pub fn create_routes(frontend_dir: Option<&str>) -> Router<Arc<AppState>> {
    let api_routes = Router::new()
        .route("/health", get(health))
        .route("/about", get(about));

    let router = Router::new().nest("/api", api_routes);

    // Serve frontend if directory is provided
    if let Some(dir) = frontend_dir {
        let serve_dir = ServeDir::new(dir).fallback(ServeFile::new(format!("{}/index.html", dir)));
        router.fallback_service(serve_dir)
    } else {
        router
    }
}

/// Health check endpoint
async fn health() -> impl IntoResponse {
    (StatusCode::OK, Json(json!({ "status": "ok" })))
}

/// About endpoint with app info
async fn about() -> impl IntoResponse {
    Json(json!({
        "name": "appwave",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}
