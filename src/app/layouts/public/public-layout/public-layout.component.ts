import { Component, inject } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { PublicNavbarComponent } from '../components/navbar/navbar.component';
import { PublicFooterComponent } from '../components/footer/footer.component';

@Component({
  selector: 'app-public-layout',
  standalone: true,
  imports: [RouterOutlet, PublicNavbarComponent, PublicFooterComponent],
  templateUrl: './public-layout.component.html',
  styleUrls: ['./public-layout.component.scss'],
})
export class PublicLayoutComponent {
  private router = inject(Router);
  private activatedRoute = inject(ActivatedRoute);

  /** Route data du composant enfant actif */
  private routeData = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => {
        let route = this.activatedRoute;
        while (route.firstChild) route = route.firstChild;
        return route.snapshot.data;
      })
    ),
    { initialValue: {} as Record<string, unknown> }
  );

  readonly hideNavbar = () => !!this.routeData()['hideNavbar'];
  readonly minimalFooter = () => !!this.routeData()['minimalFooter'];
}