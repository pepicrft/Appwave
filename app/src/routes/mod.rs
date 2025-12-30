mod health;
mod projects;
mod xcode;

use crate::server::AppState;
use crate::simulator;
use axum::{
    routing::{get, post},
    Router,
};
use std::sync::Arc;
use tower_http::services::{ServeDir, ServeFile};

/// Create all routes for the application
pub fn create_routes(frontend_dir: Option<&str>) -> Router<Arc<AppState>> {
    let api_routes = Router::new()
        .route("/health", get(health::health))
        .route("/about", get(health::about))
        .route("/projects/validate", post(projects::validate_project))
        .route("/projects/recent", get(projects::get_recent_projects))
        .route("/xcode/discover", post(xcode::discover_project))
        .route("/xcode/build", post(xcode::build_scheme))
        .route("/xcode/build/stream", post(xcode::build_scheme_stream))
        .route(
            "/xcode/launchable-products",
            post(xcode::get_launchable_products),
        )
        .route("/simulator/list", get(simulator::list_simulators))
        .route("/simulator/launch", post(simulator::install_and_launch))
        .route("/simulator/stream", get(simulator::stream_simulator))
        .route("/simulator/stream/logs", get(simulator::stream_logs));

    let router = Router::new().nest("/api", api_routes);

    // Serve frontend if directory is provided
    if let Some(dir) = frontend_dir {
        let serve_dir = ServeDir::new(dir).fallback(ServeFile::new(format!("{}/index.html", dir)));
        router.fallback_service(serve_dir)
    } else {
        router
    }
}
